import forge from "node-forge";

/**
 * Firma digital PAdES básica (adbe.pkcs7.detached) con certificados .p12/.pfx.
 * El PDF se guarda con un hueco en /Contents y un /ByteRange provisional; aquí se
 * rellenan ambos con la firma PKCS#7 de todo el archivo salvo ese hueco.
 */

/** Bytes reservados para la firma (cabe RSA-4096 con una cadena de varios certificados). */
export const SIG_BYTES = 16384;
/**
 * Valores provisionales del /ByteRange, de ancho fijo para poder sustituirlos sin mover bytes.
 * Menores que 2^31: MuPDF escribe los enteros mayores como reales y pierde precisión.
 */
export const BYTE_RANGE_PLACEHOLDER = [0, 1111111111, 1222222222, 1333333333];

export type Identity = {
  key: forge.pki.rsa.PrivateKey;
  cert: forge.pki.Certificate;
  chain: forge.pki.Certificate[];
  name: string;
  issuer: string;
  validFrom: Date;
  validTo: Date;
};

export type SignatureCheck = {
  signer: string;
  issuer: string;
  signedAt: Date | null;
  /** El contenido firmado no ha cambiado y la firma criptográfica es correcta. */
  intact: boolean;
  /** La firma abarca el archivo entero: no hay cambios guardados después de firmar. */
  coversWholeDocument: boolean;
  /** El certificado estaba vigente en el momento de la firma. */
  certValidAtSigning: boolean;
  problem: string | null;
};

const OID = {
  data: forge.pki.oids.data,
  contentType: forge.pki.oids.contentType,
  messageDigest: forge.pki.oids.messageDigest,
  signingTime: forge.pki.oids.signingTime,
};

export function loadIdentity(p12: Uint8Array, password: string): Identity {
  let parsed: forge.pkcs12.Pkcs12Pfx;
  try {
    parsed = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(toBinary(p12)), password);
  } catch {
    throw new Error("No se pudo abrir el certificado: la contraseña es incorrecta o el archivo no es un .p12/.pfx válido");
  }
  const keyBag =
    parsed.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0] ??
    parsed.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0];
  const certs = (parsed.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).map((b) => b.cert).filter((c): c is forge.pki.Certificate => !!c);
  if (!keyBag?.key) throw new Error("El certificado no contiene clave privada (o usa claves de curva elíptica, que aún no se admiten)");
  const key = keyBag.key as forge.pki.rsa.PrivateKey;
  // El certificado del firmante es el que corresponde a la clave privada
  const cert = certs.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n.equals(key.n));
  if (!cert) throw new Error("El archivo no contiene el certificado de la clave privada");
  return {
    key,
    cert,
    chain: certs.filter((c) => c !== cert),
    name: commonName(cert.subject),
    issuer: commonName(cert.issuer),
    validFrom: cert.validity.notBefore,
    validTo: cert.validity.notAfter,
  };
}

/** Rellena /ByteRange y /Contents del PDF preparado y devuelve el PDF firmado. */
export function applySignature(pdf: Uint8Array, identity: Identity, signingTime: Date): Uint8Array {
  const out = pdf.slice();
  const text = latin1(out);
  const contentsHex = `<${"0".repeat(SIG_BYTES * 2)}>`;
  const start = text.lastIndexOf(contentsHex);
  if (start < 0) throw new Error("El documento no tiene el hueco reservado para la firma");
  const end = start + contentsHex.length;

  const placeholder = new RegExp(`\\[\\s*${BYTE_RANGE_PLACEHOLDER.join("\\s+")}\\s*\\]`, "g");
  const matches = [...text.matchAll(placeholder)];
  const match = matches[matches.length - 1];
  if (!match) throw new Error("El documento no tiene el /ByteRange provisional");
  const byteRange = [0, start, end, out.length - end];
  const value = `[${byteRange.join(" ")}]`;
  if (value.length > match[0].length) throw new Error("El /ByteRange no cabe en el espacio reservado");
  writeAscii(out, match.index!, value.padEnd(match[0].length, " "));

  if (now(signingTime) > identity.validTo.getTime() || now(signingTime) < identity.validFrom.getTime()) {
    throw new Error(`El certificado no está vigente (válido del ${fmt(identity.validFrom)} al ${fmt(identity.validTo)})`);
  }

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(toBinary(out.subarray(0, start)) + toBinary(out.subarray(end)));
  p7.addCertificate(identity.cert);
  for (const c of identity.chain) p7.addCertificate(c);
  p7.addSigner({
    key: identity.key,
    certificate: identity.cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: OID.contentType, value: OID.data },
      { type: OID.messageDigest },
      { type: OID.signingTime, value: signingTime as unknown as string },
    ],
  });
  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  const hex = forge.util.bytesToHex(der);
  if (hex.length > SIG_BYTES * 2) throw new Error("La firma es más grande que el espacio reservado");
  writeAscii(out, start + 1, hex.padEnd(SIG_BYTES * 2, "0"));
  return out;
}

/** Comprueba una firma a partir del archivo completo y los valores /ByteRange y /Contents de su diccionario. */
export function verifySignature(pdf: Uint8Array, byteRange: number[], contents: Uint8Array): SignatureCheck {
  const base: SignatureCheck = { signer: "", issuer: "", signedAt: null, intact: false, coversWholeDocument: false, certValidAtSigning: false, problem: null };
  const [a, b, c, d] = byteRange;
  base.coversWholeDocument = a === 0 && c + d === pdf.length;
  try {
    if (byteRange.length !== 4 || b > pdf.length || c + d > pdf.length) throw new Error("El /ByteRange no corresponde a este archivo");
    const msg = forge.pkcs7.messageFromAsn1(fromDerLenient(toBinary(contents))) as forge.pkcs7.PkcsSignedData & {
      rawCapture: { signerInfos: forge.asn1.Asn1[] };
    };
    const info = msg.rawCapture.signerInfos[0];
    if (!info) throw new Error("La firma no contiene firmante");
    const fields = info.value as forge.asn1.Asn1[];
    const serial = forge.util.bytesToHex(((fields[1].value as forge.asn1.Asn1[])[1].value as string) ?? "");
    const cert = msg.certificates.find((x) => x.serialNumber.replace(/^0+/, "") === serial.replace(/^0+/, "")) ?? msg.certificates[0];
    if (!cert) throw new Error("La firma no incluye el certificado del firmante");
    base.signer = commonName(cert.subject);
    base.issuer = commonName(cert.issuer);

    const digestOid = forge.asn1.derToOid((fields[2].value as forge.asn1.Asn1[])[0].value as string);
    const auth = fields.find((f) => f.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && f.type === 0);
    const sigValue = fields.find((f, i) => i > 3 && f.type === forge.asn1.Type.OCTETSTRING);
    if (!auth || !sigValue) throw new Error("Firma sin atributos firmados (formato no admitido)");

    const attrs = new Map<string, forge.asn1.Asn1>();
    for (const attr of auth.value as forge.asn1.Asn1[]) {
      const [oid, set] = attr.value as forge.asn1.Asn1[];
      attrs.set(forge.asn1.derToOid(oid.value as string), (set.value as forge.asn1.Asn1[])[0]);
    }
    const time = attrs.get(OID.signingTime);
    if (time) base.signedAt = time.type === forge.asn1.Type.UTCTIME ? forge.asn1.utcTimeToDate(time.value as string) : forge.asn1.generalizedTimeToDate(time.value as string);

    const md = digest(digestOid);
    md.update(toBinary(pdf.subarray(a, a + b)));
    md.update(toBinary(pdf.subarray(c, c + d)));
    const contentMatches = attrs.get(OID.messageDigest)?.value === md.digest().getBytes();

    // La firma se calcula sobre los atributos codificados como SET, no como [0]
    const signedAttrs = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, auth.value as forge.asn1.Asn1[]);
    const attrsMd = digest(digestOid);
    attrsMd.update(forge.asn1.toDer(signedAttrs).getBytes());
    const signatureOk = (cert.publicKey as forge.pki.rsa.PublicKey).verify(attrsMd.digest().getBytes(), sigValue.value as string);

    base.intact = contentMatches && signatureOk;
    const at = base.signedAt?.getTime() ?? Date.now();
    base.certValidAtSigning = at >= cert.validity.notBefore.getTime() && at <= cert.validity.notAfter.getTime();
    if (!contentMatches) base.problem = "El contenido firmado ha sido alterado";
    else if (!signatureOk) base.problem = "La firma criptográfica no es válida";
    else if (!base.certValidAtSigning) base.problem = "El certificado no estaba vigente al firmar";
    else if (!base.coversWholeDocument) base.problem = "Se han guardado cambios después de firmar";
  } catch (e) {
    base.problem = e instanceof Error ? e.message : String(e);
  }
  return base;
}

/** /Contents va relleno de ceros tras la firma: hay que ignorar los bytes sobrantes (los tipos de forge no recogen la opción). */
const fromDerLenient = (bytes: string) => (forge.asn1.fromDer as unknown as (b: string, o: { parseAllBytes: boolean }) => forge.asn1.Asn1)(bytes, { parseAllBytes: false });

function digest(oid: string): forge.md.MessageDigest {
  const name = forge.pki.oids[oid];
  if (name === "sha256") return forge.md.sha256.create();
  if (name === "sha384") return forge.md.sha384.create();
  if (name === "sha512") return forge.md.sha512.create();
  if (name === "sha1") return forge.md.sha1.create();
  throw new Error(`Algoritmo de resumen no admitido: ${name ?? oid}`);
}

function commonName(dn: forge.pki.Certificate["subject"]): string {
  return (dn.getField("CN")?.value as string | undefined) ?? (dn.getField("O")?.value as string | undefined) ?? "(sin nombre)";
}

const now = (d: Date) => d.getTime();
const fmt = (d: Date) => d.toLocaleDateString("es-ES");

/** Uint8Array → cadena binaria de forge, por trozos para no desbordar la pila. */
function toBinary(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
}

const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

function writeAscii(target: Uint8Array, at: number, text: string) {
  for (let i = 0; i < text.length; i++) target[at + i] = text.charCodeAt(i);
}
