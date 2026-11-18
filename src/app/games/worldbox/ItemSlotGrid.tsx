"use client";
import type { ReactNode } from "react";
import { itemById } from "@/lib/worldbox/economy/items";

export function ItemIcon({ id, size = 24 }: { id: string; size?: number }) {
  const def = itemById(id);
  if (!def?.icon) return null;
  return (
    <img
      src={def.icon}
      alt=""
      width={size}
      height={size}
      draggable={false}
      style={{ imageRendering: "pixelated", flexShrink: 0 }}
    />
  );
}

const slotStyle: React.CSSProperties = {
  position: "relative",
  boxSizing: "border-box",
  width: 48,
  height: 48,
  minWidth: 48,
  minHeight: 48,
  padding: 4,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 1,
  borderRadius: 10,
  cursor: "pointer",
  border: "1px solid rgba(255,255,255,0.25)",
  background: "rgba(255,255,255,0.06)",
  color: "inherit",
  touchAction: "manipulation",
  userSelect: "none",
  WebkitUserSelect: "none",
  WebkitTouchCallout: "none",
};

export function ItemSlot({
  itemId,
  count,
  badge,
  selected,
  disabled,
  onClick,
}: {
  itemId: string;
  count?: number;
  badge?: string;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const def = itemById(itemId);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={!!selected}
      aria-label={def?.name ?? itemId}
      style={{
        ...slotStyle,
        ...(selected
          ? { background: "rgba(255,210,62,0.18)", borderColor: "rgba(255,210,62,0.85)" }
          : {}),
        ...(disabled ? { cursor: "default", opacity: 0.55 } : {}),
      }}
    >
      {def?.icon ? (
        <ItemIcon id={itemId} size={badge ? 24 : 28} />
      ) : (
        <span
          aria-hidden
          style={{
            width: 18,
            height: 18,
            borderRadius: 4,
            border: "1px dashed rgba(255,255,255,0.45)",
            display: "block",
          }}
        />
      )}
      {badge ? (
        <span
          aria-hidden
          style={{
            fontSize: 10,
            fontWeight: 700,
            lineHeight: 1,
            color: "#fff",
            textShadow: "0 1px 2px rgba(0,0,0,0.9)",
            pointerEvents: "none",
          }}
        >
          {badge}
        </span>
      ) : null}
      {count !== undefined ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            right: 3,
            bottom: 2,
            fontSize: 10,
            fontWeight: 700,
            lineHeight: 1,
            color: "#fff",
            textShadow: "0 1px 2px rgba(0,0,0,0.9)",
            pointerEvents: "none",
          }}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

export function ItemSlotGrid({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{children}</div>;
}

export function ItemAnnotation({ itemId, children }: { itemId: string; children?: ReactNode }) {
  const def = itemById(itemId);
  if (!def) return null;
  return (
    <div
      style={{
        marginTop: 10,
        padding: "9px 10px",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(255,255,255,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <ItemIcon id={itemId} />
        <strong>{def.name}</strong>
        <span className="muted">{def.desc}</span>
      </div>
      {children}
    </div>
  );
}
