import { Children } from "react";
import type { OrderItem } from "@/lib/types";

type SpecItem = Partial<OrderItem> & {
  clothingType?: string;
  clothingCode?: string;
  fabricType?: string;
  color?: string;
  notes?: string;
  neckType?: string;
  handType?: string;
  size?: string;
  quantity?: number;
  measurements?: OrderItem["measurements"];
};

function val(v?: string | number | null) {
  if (v == null) return "";
  const s = String(v).trim();
  return s && s !== "unspecified" ? s : "";
}

function Row({ k, v }: { k: string; v?: string }) {
  if (!v) return null;
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-ink-muted">{k}</dt>
      <dd className="font-medium capitalize text-ink">{v}</dd>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  const items = Children.toArray(children).filter(Boolean);
  if (!items.length) return null;
  return (
    <section>
      <h3 className="ui-label border-b border-line pb-1">{title}</h3>
      <dl className="mt-1">{items}</dl>
    </section>
  );
}

function isTrouser(type?: string) {
  return /pant|trouser/i.test(String(type || ""));
}

function isShirt(type?: string) {
  return /shirt|top/i.test(String(type || ""));
}

export function SpecSheet({ item }: { item: SpecItem }) {
  const m = item.measurements || {};
  const trouser = isTrouser(item.clothingType);
  const shirt = isShirt(item.clothingType);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Block title="Garment">
        <Row k="Type" v={item.clothingType} />
        <Row k="Code" v={item.clothingCode} />
        <Row k="Quantity" v={item.quantity ? String(item.quantity) : ""} />
        <Row k="Size" v={val(item.size)} />
      </Block>
      <Block title="Fabric">
        <Row k="Fabric" v={val(item.fabricType)} />
        <Row k="Color" v={val(item.color)} />
      </Block>
      {!trouser ? (
        <Block title={shirt ? "Shirt" : "Measurements"}>
          <Row k="Chest" v={val(m.chest || m.breast)} />
          <Row k="Shoulder" v={val(m.shoulder)} />
          <Row k="Sleeve" v={val(m.arm)} />
          <Row k="Collar" v={val(item.neckType)} />
          <Row k="Cuff" v={val(item.handType)} />
          <Row k="Length" v={val(m.height)} />
        </Block>
      ) : null}
      {trouser ? (
        <Block title="Trouser">
          <Row k="Waist" v={val(m.waist)} />
          <Row k="Hip" v={val(m.vest)} />
          <Row k="Inseam" v={val(m.height)} />
          <Row k="Fit / size" v={val(item.size)} />
        </Block>
      ) : shirt ? null : (
        <Block title="Lower body">
          <Row k="Waist" v={val(m.waist)} />
          <Row k="Hip" v={val(m.vest)} />
          <Row k="Inseam" v={val(m.height)} />
        </Block>
      )}
      {val(item.notes) ? (
        <Block title="Special instructions">
          <p className="py-1.5 text-sm text-ink">{item.notes}</p>
        </Block>
      ) : null}
    </div>
  );
}
