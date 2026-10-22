import { useState } from "react";
import { createPortal } from "react-dom";
import type { OutlineNode } from "../pdf/engine";

type Props = {
  items: OutlineNode[];
  /** Se pueden añadir y cambiar marcadores (lo permite el documento). */
  editable: boolean;
  /** Marcador cuyo nombre se está escribiendo (ruta unida con puntos), p. ej. el recién añadido. */
  renaming: string | null;
  onRenaming: (key: string | null) => void;
  onSelect: (page: number) => void;
  onAdd: () => void;
  /** Proponer marcadores a partir de los títulos del documento. */
  onFromHeadings: () => void;
  onRename: (path: number[], title: string) => void;
  onDelete: (path: number[]) => void;
  onMove: (path: number[], delta: -1 | 1) => void;
};

type Menu = { path: number[]; siblings: number; x: number; y: number };

/** Marcadores del documento: ir a su página y, si se puede, añadir, renombrar, ordenar y borrar. */
export function Outline(props: Props) {
  const { items, editable } = props;
  const [menu, setMenu] = useState<Menu | null>(null);
  return (
    <div className="outline-panel">
      <div className="outline-head">
        <span>Marcadores</span>
        <span className="outline-actions">
          <button onClick={props.onFromHeadings} disabled={!editable} title="Crear marcadores a partir de los títulos del documento">
            Desde títulos…
          </button>
          <button onClick={props.onAdd} disabled={!editable} title="Añadir un marcador a la página actual (⌘B)">
            ＋ Añadir
          </button>
        </span>
      </div>
      {items.length === 0 ? (
        <p className="sidebar-empty">Este documento no tiene marcadores. Pulsa «Añadir» para marcar la página actual.</p>
      ) : (
        <OutlineList {...props} path={[]} onMenu={editable ? setMenu : null} />
      )}
      {/* En el body: dentro del panel lateral quedaría por debajo de las páginas */}
      {menu &&
        createPortal(
          <div className="modal-backdrop menu-backdrop" onMouseDown={() => setMenu(null)}>
            <div
              className="menu context-menu"
              role="menu"
              style={{ left: menu.x, top: menu.y }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setMenu(null)}
            >
              <button role="menuitem" onClick={() => props.onRenaming(menu.path.join("."))}>
                Cambiar nombre
              </button>
              <button role="menuitem" disabled={menu.path[menu.path.length - 1] === 0} onClick={() => props.onMove(menu.path, -1)}>
                Subir
              </button>
              <button role="menuitem" disabled={menu.path[menu.path.length - 1] === menu.siblings - 1} onClick={() => props.onMove(menu.path, 1)}>
                Bajar
              </button>
              <button role="menuitem" onClick={() => props.onDelete(menu.path)}>
                Eliminar
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

type ListProps = Props & { path: number[]; onMenu: ((m: Menu) => void) | null };

function OutlineList(props: ListProps) {
  const { items, path } = props;
  return (
    <ul className="outline">
      {items.map((item, i) => {
        const here = [...path, i];
        const link = <OutlineLink {...props} item={item} path={here} siblings={items.length} />;
        return (
          <li key={i}>
            {item.children.length > 0 ? (
              <details open>
                <summary>{link}</summary>
                <OutlineList {...props} items={item.children} path={here} />
              </details>
            ) : (
              link
            )}
          </li>
        );
      })}
    </ul>
  );
}

function OutlineLink(props: ListProps & { item: OutlineNode; siblings: number }) {
  const { item, path, editable, onMenu } = props;
  const key = path.join(".");
  if (props.renaming === key) {
    const finish = (title: string | null) => {
      props.onRenaming(null);
      if (title !== null && title.trim() && title.trim() !== item.title) props.onRename(path, title);
    };
    return (
      <input
        className="outline-rename"
        aria-label="Nombre del marcador"
        defaultValue={item.title}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => finish(e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") finish(null);
        }}
      />
    );
  }
  return (
    <button
      className="outline-link"
      disabled={item.page === null && !editable}
      title={editable ? "Doble clic para cambiar el nombre; clic derecho para más opciones" : undefined}
      onClick={() => item.page !== null && props.onSelect(item.page)}
      onDoubleClick={() => editable && props.onRenaming(key)}
      onContextMenu={(e) => {
        if (!onMenu) return;
        e.preventDefault();
        onMenu({ path, siblings: props.siblings, x: e.clientX, y: e.clientY });
      }}
      onKeyDown={(e) => {
        if (!editable) return;
        if (e.key === "Delete" || e.key === "Backspace") props.onDelete(path);
        else if (e.key === "F2") props.onRenaming(key);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {item.title || "(sin título)"}
    </button>
  );
}
