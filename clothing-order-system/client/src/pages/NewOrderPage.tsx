import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiJson, ApiError, balanceRemaining } from "@/lib/api";
import type {
  ClothingAudience,
  ClothingTypeConfig,
  Customer,
  HandType,
  ItemKind,
  ItemSetChoice,
  NeckType,
  Order,
  OrderGroup,
  OrderItem,
  OrderItemImage,
  OrderPriority,
  SizeCategory
} from "@/lib/types";
import { CustomerPicker } from "@/components/CustomerPicker";
import { ClothingTypePicker } from "@/components/ClothingTypePicker";
import { ImageGalleryUploader } from "@/components/ImageGalleryUploader";
import { SpecSheet } from "@/components/SpecSheet";
import { PageHeader, ErrorState, EmptyState } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import {
  groupsForScope,
  itemGenderToCategory,
  valuesToCustomerMeasurementBody,
  valuesToItemMeasurements,
  type MeasurementCategory,
  type MeasureScope
} from "@/lib/measurementSchema";
import {
  CLOTHING_AUDIENCE_OPTIONS,
  FEMALE_ACCESSORY_OPTIONS,
  MALE_SET_OPTIONS,
  audienceItemGender,
  audienceMeasureCategory,
  audienceShortLabel,
  audienceSize,
  isFemaleAudience,
  isMaleAudience,
  maleSetHelper,
  measureScopeForSet
} from "@/lib/clothingAudience";
import { formatMoney } from "@/lib/format";
import { useToast } from "@/context/ToastContext";
import clsx from "clsx";

type Phase = "customer" | "garments" | "edit" | "schedule" | "review";
type EditStep = 0 | 1 | 2 | 3 | 4 | 5;
type GarmentWizard = "list" | "category" | "options";

type Draft = {
  key: string;
  clothingType: string;
  clothingCode: string;
  fabricType: string;
  color: string;
  notes: string;
  neckType: NeckType;
  handType: HandType;
  size: SizeCategory;
  images: OrderItemImage[];
  productionDays: number;
  unitPrice: number;
  difficultyLevel: number;
  category: MeasurementCategory;
  measureValues: Record<string, string>;
  copiedFromPrevious?: boolean;
  selectedPartCodes?: string[];
  audience?: ClothingAudience;
  setChoice?: ItemSetChoice;
  measureScope?: MeasureScope;
  itemKind?: ItemKind;
};

const EDIT_LABELS = ["Type", "Reuse", "Fit", "Specs", "Images", "Price"];

function newKey() {
  return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function emptyDraft(): Draft {
  return {
    key: newKey(),
    clothingType: "",
    clothingCode: "",
    fabricType: "",
    color: "",
    notes: "",
    neckType: "oval",
    handType: "normal",
    size: "adult",
    images: [],
    productionDays: 3,
    unitPrice: 0,
    difficultyLevel: 3,
    category: "male",
    measureValues: {},
    measureScope: "all",
    itemKind: "garment"
  };
}

function draftFromType(
  types: ClothingTypeConfig[],
  key: "shirt" | "pants" | "belt" | "netela",
  audience: ClothingAudience,
  setChoice: ItemSetChoice
): Draft {
  const t = types.find((c) => c.key === key);
  const fallback =
    key === "shirt" ? "Shirt" : key === "pants" ? "Trouser" : key === "belt" ? "Belt" : "Netela";
  const accessory = t?.itemKind === "accessory" || key === "belt" || key === "netela";
  const scope = accessory
    ? "none"
    : setChoice === "both"
      ? key === "shirt"
        ? "upper"
        : "lower"
      : measureScopeForSet(setChoice);
  return {
    ...emptyDraft(),
    clothingType: t?.label || fallback,
    clothingCode: (t?.key || key).toUpperCase(),
    category: audienceMeasureCategory(audience),
    size: audienceSize(audience),
    audience,
    setChoice,
    measureScope: scope,
    itemKind: accessory ? "accessory" : "garment"
  };
}

function draftFromItem(src: OrderItem, category?: MeasurementCategory): Draft {
  const audience = (src.audience || undefined) as ClothingAudience | undefined;
  const cat =
    category ||
    (audience ? audienceMeasureCategory(audience) : itemGenderToCategory(src.measurements?.gender, src.size));
  const setChoice = (src.setChoice || undefined) as ItemSetChoice | undefined;
  return {
    key: newKey(),
    clothingType: src.clothingType,
    clothingCode: src.clothingCode,
    fabricType: src.fabricType,
    color: src.color,
    notes: src.notes,
    neckType: src.neckType,
    handType: src.handType,
    size: src.size,
    images: [],
    productionDays: src.productionDays || 3,
    unitPrice: src.unitPrice || 0,
    difficultyLevel: src.difficultyLevel || 3,
    category: cat,
    measureValues: {
      chest: src.measurements?.chest || "",
      bust: src.measurements?.breast || src.measurements?.chest || "",
      waist: src.measurements?.waist || "",
      hip: src.measurements?.vest || "",
      shoulder: src.measurements?.shoulder || "",
      sleeveLength: src.measurements?.arm || "",
      height: src.measurements?.height || "",
      dressLength: src.measurements?.height || ""
    },
    audience,
    setChoice,
    measureScope: src.itemKind === "accessory" ? "none" : measureScopeForSet(setChoice),
    itemKind: src.itemKind === "accessory" ? "accessory" : "garment"
  };
}

function toPayloadItem(d: Draft) {
  const accessory = d.itemKind === "accessory";
  const measurements =
    accessory || d.measureScope === "none"
      ? undefined
      : {
          ...valuesToItemMeasurements(d.category, d.measureValues),
          ...(d.audience ? { gender: audienceItemGender(d.audience) } : {})
        };
  const size = d.audience
    ? audienceSize(d.audience)
    : d.category === "baby"
      ? "baby"
      : d.category === "child"
        ? "kids"
        : d.size || "adult";
  return {
    clothingCode: d.clothingCode || d.clothingType.slice(0, 8).toUpperCase(),
    clothingType: d.clothingType,
    fabricType: d.fabricType || "unspecified",
    color: d.color || "unspecified",
    quantity: 1,
    notes: d.notes,
    neckType: d.neckType,
    handType: d.handType,
    size,
    measurements,
    productionDays: d.productionDays,
    unitPrice: Number(d.unitPrice) || 0,
    difficultyLevel: d.difficultyLevel,
    audience: d.audience || undefined,
    setChoice: d.setChoice || undefined,
    itemKind: d.itemKind || "garment",
    images: (d.images || []).map((img) => ({
      imageUrl: img.imageUrl,
      caption: img.caption || "",
      category: img.category || "other"
    }))
  };
}

function firstEditStep(d: Draft): EditStep {
  if (d.itemKind === "accessory") return 3;
  if (d.clothingType.trim()) return 1;
  return 0;
}

function nextEditStep(d: Draft, step: EditStep): EditStep {
  let n = Math.min(5, step + 1) as EditStep;
  if (n === 2 && (d.itemKind === "accessory" || d.measureScope === "none")) n = 3;
  return n;
}

function prevEditStep(d: Draft, step: EditStep): EditStep | "cancel" {
  const first = firstEditStep(d);
  if (step <= first) return "cancel";
  let p = (step - 1) as EditStep;
  if (p === 2 && (d.itemKind === "accessory" || d.measureScope === "none")) {
    p = (first < 2 ? first : 1) as EditStep;
  }
  return p < first ? "cancel" : p;
}

export function NewOrderPage() {
  const navigate = useNavigate();
  const { push } = useToast();
  const [params] = useSearchParams();
  const [phase, setPhase] = useState<Phase>("customer");
  const [editStep, setEditStep] = useState<EditStep>(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [types, setTypes] = useState<ClothingTypeConfig[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(params.get("customerId"));
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [reuseMode, setReuseMode] = useState<"scratch" | "previous">("scratch");
  const [deposit, setDeposit] = useState(0);
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<OrderPriority>("NORMAL");
  const [orderKind, setOrderKind] = useState<"individual" | "group">("individual");
  const [groupMode, setGroupMode] = useState<"new" | "existing">("existing");
  const [groups, setGroups] = useState<OrderGroup[]>([]);
  const [groupId, setGroupId] = useState(params.get("groupId") || "");
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupPerson, setNewGroupPerson] = useState("");
  const [newGroupPhone, setNewGroupPhone] = useState("");
  const [newGroupNotes, setNewGroupNotes] = useState("");
  const [useGroupDue, setUseGroupDue] = useState(false);
  const [useGroupPriority, setUseGroupPriority] = useState(false);
  const [garmentWizard, setGarmentWizard] = useState<GarmentWizard>("category");
  const [pendingAudience, setPendingAudience] = useState<ClothingAudience | null>(null);
  const [pendingMaleSet, setPendingMaleSet] = useState<"" | "shirt" | "trouser" | "both">("");
  const [pendingAccessories, setPendingAccessories] = useState<Array<"belt" | "netela">>([]);
  const [collectQueue, setCollectQueue] = useState<Draft[]>([]);
  const [partLabelMode, setPartLabelMode] = useState<"none" | "all" | "selected">("none");

  useEffect(() => {
    apiJson<ClothingTypeConfig[]>("/api/clothing-types").then(setTypes).catch(() => {});
    apiJson<OrderGroup[]>("/api/order-groups")
      .then((rows) => {
        setGroups(rows);
        const preset = params.get("groupId");
        if (preset) {
          setOrderKind("group");
          setGroupMode("existing");
          setGroupId(preset);
        }
      })
      .catch(() => {});
  }, [params]);

  useEffect(() => {
    const cid = params.get("customerId");
    if (!cid) return;
    apiJson<Customer>(`/api/customers/${cid}`)
      .then((c) => {
        setCustomer(c);
        setCustomerId(c._id);
        setCustomerName(c.name);
        setCustomerPhone(c.phone);
        const reuseId = params.get("reuseItem");
        if (reuseId) {
          const found = c.orders?.flatMap((o) => o.items || []).find((it) => it._id === reuseId);
          if (found) {
            setDrafts([{ ...draftFromItem(found), copiedFromPrevious: true }]);
            setGarmentWizard("list");
            setPhase("garments");
          }
        }
      })
      .catch(() => {});
  }, [params]);

  const previousItems = useMemo(
    () =>
      (customer?.orders || []).flatMap((o) =>
        (o.items || []).map((it) => ({ orderId: o.orderId, createdAt: o.createdAt, item: it }))
      ),
    [customer]
  );

  const agreed = drafts.reduce((s, d) => s + (Number(d.unitPrice) || 0), 0);
  const balance = balanceRemaining(agreed, deposit);

  function resetAddSession() {
    setPendingAudience(null);
    setPendingMaleSet("");
    setPendingAccessories([]);
    setCollectQueue([]);
  }

  function beginAdd() {
    resetAddSession();
    setGarmentWizard("category");
    setPhase("garments");
  }

  function pickAudience(id: ClothingAudience) {
    setPendingAudience(id);
    setPendingMaleSet("");
    setPendingAccessories([]);
    setGarmentWizard("options");
  }

  function draftsForCurrentSelection(): Draft[] | null {
    if (!pendingAudience) return null;
    if (isMaleAudience(pendingAudience)) {
      if (!pendingMaleSet) return null;
      if (pendingMaleSet === "both") {
        return [
          draftFromType(types, "shirt", pendingAudience, "both"),
          draftFromType(types, "pants", pendingAudience, "both")
        ];
      }
      return [
        draftFromType(
          types,
          pendingMaleSet === "shirt" ? "shirt" : "pants",
          pendingAudience,
          pendingMaleSet
        )
      ];
    }
    const main: Draft = {
      ...emptyDraft(),
      category: audienceMeasureCategory(pendingAudience),
      size: audienceSize(pendingAudience),
      audience: pendingAudience,
      setChoice: "garment",
      measureScope: "all",
      itemKind: "garment"
    };
    const extras = pendingAccessories.map((key) => draftFromType(types, key, pendingAudience, key));
    return [main, ...extras];
  }

  function startCollect(items: Draft[]) {
    const [first, ...rest] = items;
    if (!first) return;
    setCollectQueue(rest);
    setEditing(first);
    setEditStep(firstEditStep(first));
    setReuseMode("scratch");
    setPhase("edit");
  }

  function continueFromOptions() {
    const items = draftsForCurrentSelection();
    if (!items?.length) return;
    startCollect(items);
  }

  function optionsReady() {
    if (!pendingAudience) return false;
    if (isMaleAudience(pendingAudience)) return Boolean(pendingMaleSet);
    return true;
  }

  function beginEdit(d: Draft) {
    setCollectQueue([]);
    setEditing({ ...d, measureValues: { ...d.measureValues }, images: [...(d.images || [])] });
    setEditStep(0);
    setReuseMode("scratch");
    setPhase("edit");
  }

  function applyPreviousToEdit(src: OrderItem) {
    if (!editing) return;
    const next = draftFromItem(src);
    setEditing({
      ...next,
      key: editing.key,
      copiedFromPrevious: true,
      audience: editing.audience,
      setChoice: editing.setChoice,
      measureScope: editing.measureScope,
      itemKind: editing.itemKind,
      size: editing.audience ? audienceSize(editing.audience) : next.size,
      category: editing.audience ? audienceMeasureCategory(editing.audience) : next.category
    });
    setReuseMode("previous");
    setEditStep(2);
  }

  function saveEditing() {
    if (!editing || !editing.clothingType.trim()) return;
    setDrafts((list) => {
      const idx = list.findIndex((d) => d.key === editing.key);
      if (idx === -1) return [...list, editing];
      const copy = [...list];
      copy[idx] = editing;
      return copy;
    });
    if (collectQueue.length) {
      const [next, ...rest] = collectQueue;
      setCollectQueue(rest);
      setEditing(next);
      setEditStep(firstEditStep(next));
      setReuseMode("scratch");
      return;
    }
    setEditing(null);
    resetAddSession();
    setGarmentWizard("list");
    setPhase("garments");
  }

  function cancelEditing() {
    setEditing(null);
    setCollectQueue([]);
    setGarmentWizard(drafts.length ? "list" : "category");
    setPhase("garments");
  }

  function removeDraft(key: string) {
    setDrafts((list) => {
      const next = list.filter((d) => d.key !== key);
      if (!next.length) setGarmentWizard("category");
      return next;
    });
  }

  function canEditNext() {
    if (!editing) return false;
    if (editStep === 0) return Boolean(editing.clothingType.trim());
    return true;
  }

  async function create() {
    if (!drafts.length || !due) return;
    const dueDate = new Date(due);
    if (Number.isNaN(dueDate.getTime())) {
      setErr("Enter a valid due date");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      let resolvedGroupId = groupId || undefined;
      if (orderKind === "group" && groupMode === "new") {
        if (!newGroupName.trim()) {
          setErr("Group name is required");
          setBusy(false);
          return;
        }
        const createdGroup = await apiJson<OrderGroup>("/api/order-groups", {
          method: "POST",
          body: JSON.stringify({
            name: newGroupName.trim(),
            responsibleName: newGroupPerson,
            responsiblePhone: newGroupPhone,
            notes: newGroupNotes,
            sharedDueDate: useGroupDue && due ? new Date(due).toISOString() : undefined,
            sharedPriority: useGroupPriority ? priority : undefined
          })
        });
        resolvedGroupId = createdGroup._id;
      }
      const created = await apiJson<Order>("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          customerId: customerId || undefined,
          customerName: customerId ? undefined : customerName,
          customerPhone: customerId ? undefined : customerPhone,
          requiredCompletionDate: dueDate.toISOString(),
          priority,
          totalAgreedPrice: Number(agreed),
          depositPaid: Number(deposit),
          items: drafts.map((d) => {
            const cfg = types.find(
              (t) => t.label.toLowerCase() === d.clothingType.toLowerCase() || t.key === d.clothingCode.toLowerCase()
            );
            return {
              ...toPayloadItem(d),
              itemKind: d.itemKind || (cfg?.itemKind === "accessory" ? "accessory" : "garment"),
              selectedPartCodes: d.selectedPartCodes || []
            };
          }),
          partLabelMode,
          groupId: orderKind === "group" ? resolvedGroupId : undefined,
          useGroupDueDate: orderKind === "group" && useGroupDue,
          useGroupPriority: orderKind === "group" && useGroupPriority
        })
      });
      const cid = created.customer?._id || customerId;
      const first = drafts[0];
      if (cid && first && Object.values(first.measureValues).some(Boolean)) {
        try {
          await apiJson(`/api/customers/${cid}/measurements`, {
            method: "POST",
            body: JSON.stringify(valuesToCustomerMeasurementBody(first.category, first.measureValues))
          });
        } catch {
          /* best-effort */
        }
      }
      const garmentCount = (created.items || []).filter((it) => it.itemKind !== "part").length;
      push(`Order created · ${garmentCount} garment${garmentCount === 1 ? "" : "s"}`, "ok");
      navigate(`/orders/${encodeURIComponent(created.orderId)}`, { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not create order");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="New order"
        description="Customer first. Add every garment, then set due date and deposit."
      />

      <ol className="flex flex-wrap gap-1.5">
        {[
          { id: "customer", label: "Customer" },
          { id: "garments", label: "Garments" },
          { id: "schedule", label: "Schedule" },
          { id: "review", label: "Review" }
        ].map((s, i) => {
          const active = phase === s.id || (s.id === "garments" && phase === "edit");
          const done =
            (s.id === "customer" && phase !== "customer") ||
            (s.id === "garments" && (phase === "schedule" || phase === "review")) ||
            (s.id === "schedule" && phase === "review");
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => {
                  if (s.id === "customer") setPhase("customer");
                  if (s.id === "garments" && (customerId || customerName)) {
                    setGarmentWizard(drafts.length ? "list" : "category");
                    setPhase("garments");
                  }
                  if (s.id === "schedule" && drafts.length) setPhase("schedule");
                  if (s.id === "review" && drafts.length && due) setPhase("review");
                }}
                className={clsx(
                  "min-h-11 rounded-control px-3 py-2 text-[11px] font-medium",
                  active ? "bg-accent text-white" : done ? "bg-accent-soft text-accent" : "bg-canvas text-ink-faint"
                )}
              >
                {i + 1}. {s.label}
              </button>
            </li>
          );
        })}
      </ol>

      {err && <ErrorState message={err} />}

      <div className="ui-card p-5">
        {phase === "customer" && (
          <div className="space-y-5">
            <fieldset>
              <legend className="ui-label">Order type</legend>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className={clsx(
                    "min-h-11 rounded-control px-3 text-sm",
                    orderKind === "individual" ? "bg-accent text-white" : "bg-canvas text-ink-muted"
                  )}
                  onClick={() => setOrderKind("individual")}
                >
                  Individual
                </button>
                <button
                  type="button"
                  className={clsx(
                    "min-h-11 rounded-control px-3 text-sm",
                    orderKind === "group" ? "bg-accent text-white" : "bg-canvas text-ink-muted"
                  )}
                  onClick={() => setOrderKind("group")}
                >
                  Group / event
                </button>
              </div>
            </fieldset>
            {orderKind === "group" && (
              <div className="space-y-3 rounded-control border border-line p-3">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={groupMode === "existing" ? "primary" : "secondary"}
                    onClick={() => setGroupMode("existing")}
                  >
                    Add to existing group
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={groupMode === "new" ? "primary" : "secondary"}
                    onClick={() => setGroupMode("new")}
                  >
                    Create new group
                  </Button>
                </div>
                {groupMode === "existing" ? (
                  <select className="ui-input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                    <option value="">Select group…</option>
                    {groups.map((g) => (
                      <option key={g._id} value={g._id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      className="ui-input"
                      placeholder="Group name"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                    />
                    <input
                      className="ui-input"
                      placeholder="Responsible person"
                      value={newGroupPerson}
                      onChange={(e) => setNewGroupPerson(e.target.value)}
                    />
                    <input
                      className="ui-input"
                      placeholder="Responsible phone"
                      value={newGroupPhone}
                      onChange={(e) => setNewGroupPhone(e.target.value)}
                    />
                    <input
                      className="ui-input sm:col-span-2"
                      placeholder="Notes"
                      value={newGroupNotes}
                      onChange={(e) => setNewGroupNotes(e.target.value)}
                    />
                  </div>
                )}
                <p className="text-xs text-ink-muted">
                  Group values are defaults. Each order stays independent and can override due date and priority.
                </p>
              </div>
            )}
          <CustomerPicker
            customerId={customerId}
            customerName={customerName}
            customerPhone={customerPhone}
            onSelect={(c, latest) => {
              setCustomer(c);
              setCustomerId(c._id);
              setCustomerName(c.name);
              setCustomerPhone(c.phone);
              if (latest && !drafts.length) {
                /* preload category onto the next garment add */
              }
            }}
            onClear={() => {
              setCustomer(null);
              setCustomerId(null);
              setCustomerName("");
              setCustomerPhone("");
            }}
            onNamePhoneChange={(n, p) => {
              setCustomerName(n);
              setCustomerPhone(p);
            }}
          />
          </div>
        )}

        {phase === "garments" && (
          <div className="space-y-4">
            {drafts.length > 0 && (
              <ul className="space-y-2">
                {drafts.map((d, i) => (
                  <li
                    key={d.key}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-ink">
                        {i + 1}. {d.clothingType || "Untitled garment"}
                        {d.itemKind === "accessory" ? (
                          <span className="ml-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                            accessory
                          </span>
                        ) : null}
                        {d.copiedFromPrevious ? (
                          <span className="ml-2 text-[11px] font-medium text-accent">Copied · still editable</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {[audienceShortLabel(d.audience), d.fabricType || "Fabric TBD", d.color || "Color TBD", formatMoney(d.unitPrice)]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="secondary" onClick={() => beginEdit(d)}>
                        Edit
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => removeDraft(d.key)}>
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {garmentWizard === "list" && drafts.length > 0 && (
              <Button type="button" variant="secondary" onClick={beginAdd}>
                Add another garment
              </Button>
            )}

            {garmentWizard === "category" && (
              <fieldset>
                <legend className="ui-label">What kind of clothing?</legend>
                <p className="mt-1 text-xs text-ink-muted">
                  Choose a category first. Options come on the next screen.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {CLOTHING_AUDIENCE_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={clsx(
                        "min-h-16 rounded-control px-4 py-3 text-left transition",
                        pendingAudience === opt.id ? "bg-accent text-white" : "bg-canvas text-ink hover:bg-accent-soft"
                      )}
                      onClick={() => pickAudience(opt.id)}
                    >
                      <span className="block text-sm font-semibold">{opt.label}</span>
                      <span
                        className={clsx(
                          "mt-1 block text-xs",
                          pendingAudience === opt.id ? "text-white/80" : "text-ink-muted"
                        )}
                      >
                        {opt.hint}
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            {garmentWizard === "options" && pendingAudience && (
              <fieldset>
                <legend className="ui-label">
                  {isMaleAudience(pendingAudience) ? "Shirt, trouser, or both" : "Belt and netela"}
                </legend>
                {isMaleAudience(pendingAudience) ? (
                  <>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      {MALE_SET_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          className={clsx(
                            "min-h-14 rounded-control px-3 text-left text-sm font-medium",
                            pendingMaleSet === opt.id ? "bg-accent text-white" : "bg-canvas text-ink-muted"
                          )}
                          onClick={() => setPendingMaleSet(opt.id)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {pendingMaleSet ? (
                      <p className="mt-2 text-xs text-ink-muted">{maleSetHelper(pendingMaleSet)}</p>
                    ) : (
                      <p className="mt-2 text-xs text-ink-muted">Pick one option, then continue to measurements.</p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-xs text-ink-muted">
                      Accessories are independent items. You will still add the main garment (for example kemis).
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {FEMALE_ACCESSORY_OPTIONS.map((opt) => {
                        const on = pendingAccessories.includes(opt.id);
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            className={clsx(
                              "min-h-14 rounded-control px-3 text-left text-sm font-medium",
                              on ? "bg-accent text-white" : "bg-canvas text-ink-muted"
                            )}
                            onClick={() =>
                              setPendingAccessories((list) =>
                                on ? list.filter((id) => id !== opt.id) : [...list, opt.id]
                              )
                            }
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-xs text-ink-muted">
                      {pendingAccessories.length
                        ? `Selected accessories will be added as separate items${
                            pendingAccessories.length === 2 ? " (belt and netela)." : "."
                          }`
                        : "You can continue with a named garment only."}
                    </p>
                  </>
                )}
              </fieldset>
            )}

            {garmentWizard === "list" && drafts.length === 0 && (
              <EmptyState
                title="No garments yet"
                body="Add the first piece. You can mix categories on the same order."
                action={
                  <Button type="button" onClick={beginAdd}>
                    Add garment
                  </Button>
                }
              />
            )}
          </div>
        )}

        {phase === "edit" && editing && (
          <div className="space-y-4">
            <ol className="flex flex-wrap gap-1">
              {EDIT_LABELS.map((label, i) => (
                <li key={label}>
                  <span
                    className={clsx(
                      "rounded-control px-2 py-0.5 text-[10px] font-medium",
                      i === editStep ? "bg-accent text-white" : i < editStep ? "bg-accent-soft text-accent" : "bg-canvas text-ink-faint"
                    )}
                  >
                    {label}
                  </span>
                </li>
              ))}
            </ol>

            {editStep === 0 && (
              <div className="space-y-2">
                {editing.audience && isFemaleAudience(editing.audience) ? (
                  <p className="text-xs text-ink-muted">
                    Name the main garment (kemis, dress, abaya). Belt and netela were chosen on the previous screen.
                  </p>
                ) : null}
                <ClothingTypePicker
                  types={
                    editing.audience && isFemaleAudience(editing.audience) && editing.itemKind !== "accessory"
                      ? types.filter((t) => t.itemKind !== "accessory")
                      : types
                  }
                  value={editing.clothingType}
                onChange={(t) =>
                  setEditing((d) =>
                    d
                      ? {
                          ...d,
                          clothingType: t.label,
                          clothingCode: String(t.key || t.label)
                            .trim()
                            .replace(/\s+/g, "_")
                            .toUpperCase()
                            .slice(0, 12)
                        }
                      : d
                  )
                }
                />
              </div>
            )}

            {editStep === 1 && (
              <div className="space-y-3">
                {editing.copiedFromPrevious && (
                  <p className="rounded-control bg-accent-soft px-3 py-2 text-xs text-accent">
                    Copied from a previous garment. Change anything that is different this time.
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={reuseMode === "scratch" ? "primary" : "secondary"}
                    onClick={() => setReuseMode("scratch")}
                  >
                    Start from scratch
                  </Button>
                  <Button
                    type="button"
                    variant={reuseMode === "previous" ? "primary" : "secondary"}
                    onClick={() => setReuseMode("previous")}
                    disabled={!previousItems.length}
                  >
                    Use previous garment
                  </Button>
                </div>
                {reuseMode === "previous" && (
                  <ul className="space-y-2">
                    {previousItems.map((row) => (
                      <li key={row.item._id || `${row.orderId}-${row.item.clothingCode}`}>
                        <button
                          type="button"
                          className="w-full rounded-control border border-line px-3 py-2 text-left text-sm hover:bg-canvas"
                          onClick={() => applyPreviousToEdit(row.item)}
                        >
                          <span className="font-medium">{row.item.clothingType}</span>
                          <span className="block text-xs text-ink-muted">
                            {row.orderId} · {row.item.fabricType} · {row.item.color}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {!previousItems.length && (
                  <p className="text-sm text-ink-muted">No previous garments for this customer.</p>
                )}
              </div>
            )}

            {editStep === 2 && (
              <div className="space-y-4">
                {editing.audience ? (
                  <p className="text-sm text-ink-muted">
                    {audienceShortLabel(editing.audience)}
                    {editing.setChoice === "shirt"
                      ? " · shirt measurements (upper body)"
                      : editing.setChoice === "trouser"
                        ? " · trouser measurements (lower body)"
                        : editing.setChoice === "both"
                          ? editing.measureScope === "upper"
                            ? " · shirt measurements (upper body)"
                            : editing.measureScope === "lower"
                              ? " · trouser measurements (lower body)"
                              : " · shirt and trouser measurements"
                          : " · measurements"}
                  </p>
                ) : (
                  <select
                    className="ui-input"
                    value={editing.category}
                    onChange={(e) =>
                      setEditing((d) => (d ? { ...d, category: e.target.value as MeasurementCategory } : d))
                    }
                  >
                    <option value="male">Adult male</option>
                    <option value="female">Adult female</option>
                    <option value="child">Child</option>
                    <option value="baby">Baby</option>
                  </select>
                )}
                {groupsForScope(editing.category, editing.measureScope || "all").map((group) => (
                  <div key={group.id}>
                    <p className="ui-label mb-2">{group.label}</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {group.fields.map((f) => (
                        <label key={f.key} className="block text-xs text-ink-muted">
                          {f.label} ({f.unit})
                          <input
                            className="ui-input"
                            inputMode="decimal"
                            value={editing.measureValues[f.key] || ""}
                            onChange={(e) =>
                              setEditing((d) =>
                                d
                                  ? { ...d, measureValues: { ...d.measureValues, [f.key]: e.target.value } }
                                  : d
                              )
                            }
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {editStep === 3 && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Labeled label="Fabric">
                  <ChipRow
                    options={["cotton", "linen", "wool", "silk", "polyester", "viscose"]}
                    value={editing.fabricType}
                    onPick={(v) => setEditing((d) => (d ? { ...d, fabricType: v } : d))}
                  />
                  <input
                    className="ui-input"
                    value={editing.fabricType}
                    onChange={(e) => setEditing((d) => (d ? { ...d, fabricType: e.target.value } : d))}
                    placeholder="Or type a fabric"
                  />
                </Labeled>
                <Labeled label="Color">
                  <ChipRow
                    options={["white", "black", "cream", "navy", "beige", "grey", "brown", "olive"]}
                    value={editing.color}
                    onPick={(v) => setEditing((d) => (d ? { ...d, color: v } : d))}
                  />
                  <input
                    className="ui-input"
                    value={editing.color}
                    onChange={(e) => setEditing((d) => (d ? { ...d, color: e.target.value } : d))}
                    placeholder="Or type a color"
                  />
                </Labeled>
                {editing.itemKind === "accessory" || editing.measureScope === "lower" ? null : (
                  <>
                <Labeled label="Collar / neck">
                  <select
                    className="ui-input"
                    value={editing.neckType}
                    onChange={(e) => setEditing((d) => (d ? { ...d, neckType: e.target.value as NeckType } : d))}
                  >
                    <option value="oval">Oval</option>
                    <option value="V-shape">V-shape</option>
                    <option value="square">Square</option>
                  </select>
                </Labeled>
                <Labeled label="Sleeve / hand">
                  <select
                    className="ui-input"
                    value={editing.handType}
                    onChange={(e) => setEditing((d) => (d ? { ...d, handType: e.target.value as HandType } : d))}
                  >
                    <option value="normal">Normal</option>
                    <option value="wide">Wide</option>
                  </select>
                </Labeled>
                  </>
                )}
                <div className="sm:col-span-2">
                  <Labeled label="Special instructions">
                    <textarea
                      className="ui-input min-h-[72px]"
                      value={editing.notes}
                      onChange={(e) => setEditing((d) => (d ? { ...d, notes: e.target.value } : d))}
                    />
                  </Labeled>
                </div>
              </div>
            )}

            {editStep === 4 && (
              <ImageGalleryUploader
                images={editing.images || []}
                onChange={(images: OrderItemImage[]) => setEditing((d) => (d ? { ...d, images } : d))}
                onError={setErr}
              />
            )}

            {editStep === 5 && (
              <Labeled label="Agreed price for this garment">
                <input
                  className="ui-input tabular"
                  type="number"
                  min={0}
                  value={editing.unitPrice}
                  onChange={(e) => setEditing((d) => (d ? { ...d, unitPrice: Number(e.target.value) } : d))}
                />
              </Labeled>
            )}
          </div>
        )}

        {phase === "schedule" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="Due date">
              <input className="ui-input" type="date" required value={due} onChange={(e) => setDue(e.target.value)} />
            </Labeled>
            <Labeled label="Priority">
              <select className="ui-input" value={priority} onChange={(e) => setPriority(e.target.value as OrderPriority)}>
                <option value="NORMAL">Normal</option>
                <option value="RUSH">Rush</option>
                <option value="VIP">VIP</option>
              </select>
            </Labeled>
            {orderKind === "group" && (
              <div className="sm:col-span-2 space-y-2 text-sm text-ink-muted">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={useGroupDue} onChange={(e) => setUseGroupDue(e.target.checked)} />
                  Use group due date for this order
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={useGroupPriority}
                    onChange={(e) => setUseGroupPriority(e.target.checked)}
                  />
                  Use group priority for this order
                </label>
              </div>
            )}
            <Labeled label="Deposit (whole order)">
              <input
                className="ui-input tabular"
                type="number"
                min={0}
                value={deposit}
                onChange={(e) => setDeposit(Number(e.target.value))}
              />
            </Labeled>
            <div>
              <p className="ui-label">Order total / balance</p>
              <p className="mt-2 text-xl font-semibold tabular">
                {formatMoney(agreed)} · {formatMoney(balance)} due
              </p>
            </div>
          </div>
        )}

        {phase === "review" && (
          <div className="space-y-4 text-sm">
            <Row k="Customer" v={customerName || customer?.name || "—"} />
            <Row k="Due" v={`${due || "—"} · ${priority}`} />
            <Row k="Deposit / balance" v={`${formatMoney(deposit)} / ${formatMoney(balance)}`} />
            {drafts.some((d) => d.audience) ? (
              <Row
                k="Categories"
                v={[...new Set(drafts.map((d) => audienceShortLabel(d.audience)).filter(Boolean))].join(", ")}
              />
            ) : null}
            <ul className="space-y-3">
              {drafts.map((d) => (
                <li key={d.key} className="rounded-lg border border-line p-4">
                  <div className="flex justify-between gap-3">
                    <p className="font-semibold text-ink">{d.clothingType}</p>
                    <span className="tabular font-medium">{formatMoney(d.unitPrice)}</span>
                  </div>
                  <SpecSheet item={toPayloadItem(d) as OrderItem} />
                </li>
              ))}
            </ul>
            <p className="text-right text-base font-semibold tabular">Total {formatMoney(agreed)}</p>
            <div className="rounded-lg border border-line p-4">
              <p className="ui-label">Part labels</p>
              <p className="mt-1 text-xs text-ink-muted">
                Order and garment labels always print. Part labels are optional (wrist, body, lower body).
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(
                  [
                    ["none", "No part labels"],
                    ["all", "All part labels"],
                    ["selected", "Selected part labels"]
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPartLabelMode(id)}
                    className={clsx(
                      "rounded-control px-3 py-2 text-sm",
                      partLabelMode === id ? "bg-accent text-white" : "bg-canvas text-ink-muted"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {partLabelMode === "selected" && (
                <ul className="mt-3 space-y-3">
                  {drafts.map((d) => {
                    const cfg = types.find(
                      (t) => t.label.toLowerCase() === d.clothingType.toLowerCase()
                    );
                    const codes = cfg?.partCodes?.length ? cfg.partCodes : [];
                    if (!codes.length || cfg?.itemKind === "accessory") {
                      return (
                        <li key={d.key} className="text-xs text-ink-muted">
                          {d.clothingType}: no part labels
                        </li>
                      );
                    }
                    return (
                      <li key={d.key}>
                        <p className="text-sm font-medium text-ink">{d.clothingType}</p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {codes.map((code) => {
                            const on = (d.selectedPartCodes || []).includes(code);
                            return (
                              <button
                                key={code}
                                type="button"
                                onClick={() =>
                                  setDrafts((list) =>
                                    list.map((row) =>
                                      row.key === d.key
                                        ? {
                                            ...row,
                                            selectedPartCodes: on
                                              ? (row.selectedPartCodes || []).filter((c) => c !== code)
                                              : [...(row.selectedPartCodes || []), code]
                                          }
                                        : row
                                    )
                                  )
                                }
                                className={clsx(
                                  "rounded-control px-2.5 py-1 text-xs font-mono",
                                  on ? "bg-accent text-white" : "bg-canvas text-ink-muted"
                                )}
                              >
                                {code}
                              </button>
                            );
                          })}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-between">
        {phase === "customer" && (
          <>
            <span />
            <Button
              type="button"
              disabled={!customerId && !(customerName.trim() && customerPhone.trim())}
              onClick={() => {
                setGarmentWizard(drafts.length ? "list" : "category");
                setPhase("garments");
              }}
            >
              Continue
            </Button>
          </>
        )}
        {phase === "garments" && garmentWizard === "list" && (
          <>
            <Button type="button" variant="secondary" onClick={() => setPhase("customer")}>
              Back
            </Button>
            <Button type="button" disabled={!drafts.length} onClick={() => setPhase("schedule")}>
              Continue
            </Button>
          </>
        )}
        {phase === "garments" && garmentWizard === "category" && (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (drafts.length) setGarmentWizard("list");
                else setPhase("customer");
              }}
            >
              Back
            </Button>
            <span />
          </>
        )}
        {phase === "garments" && garmentWizard === "options" && (
          <>
            <Button type="button" variant="secondary" onClick={() => setGarmentWizard("category")}>
              Back
            </Button>
            <Button type="button" disabled={!optionsReady()} onClick={continueFromOptions}>
              Continue
            </Button>
          </>
        )}
        {phase === "edit" && editing && (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const prev = prevEditStep(editing, editStep);
                if (prev === "cancel") cancelEditing();
                else setEditStep(prev);
              }}
            >
              Back
            </Button>
            {editStep < 5 ? (
              <Button
                type="button"
                disabled={!canEditNext()}
                onClick={() => setEditStep(nextEditStep(editing, editStep))}
              >
                Continue
              </Button>
            ) : (
              <Button type="button" onClick={saveEditing}>
                {collectQueue.length
                  ? editing.itemKind === "accessory"
                    ? "Save accessory"
                    : "Save and next"
                  : editing.itemKind === "accessory"
                    ? "Save accessory"
                    : "Save garment"}
              </Button>
            )}
          </>
        )}
        {phase === "schedule" && (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setGarmentWizard("list");
                setPhase("garments");
              }}
            >
              Back
            </Button>
            <Button type="button" disabled={!due} onClick={() => setPhase("review")}>
              Continue
            </Button>
          </>
        )}
        {phase === "review" && (
          <>
            <Button type="button" variant="secondary" onClick={() => setPhase("schedule")}>
              Back
            </Button>
            <Button type="button" disabled={busy || !drafts.length || !due} onClick={create}>
              {busy ? "Creating…" : `Create order · ${drafts.length} garment${drafts.length === 1 ? "" : "s"}`}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function ChipRow({
  options,
  value,
  onPick
}: {
  options: string[];
  value: string;
  onPick: (v: string) => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const on = value.trim().toLowerCase() === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onPick(opt)}
            className={clsx(
              "rounded-control px-2.5 py-1 text-xs capitalize",
              on ? "bg-accent text-white" : "bg-canvas text-ink-muted hover:text-ink"
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="ui-label">{label}</label>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2">
      <dt className="text-ink-muted">{k}</dt>
      <dd className="font-medium text-ink">{v}</dd>
    </div>
  );
}
