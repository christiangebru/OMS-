import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiJson, ApiError, apiBaseUrl, authToken } from "@/lib/api";
import type { ScanDetails } from "@/lib/types";
import { daysLabel, formatDate, formatMoney, stageLabel, boardStatusLabel, handoverLabel, shortOrderId } from "@/lib/format";
import { PageHeader, ErrorState, Skeleton, Badge } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { BarcodeImage } from "@/components/BarcodeImage";
import { ProductionTimeline } from "@/components/ProductionTimeline";
import { AssignmentChain } from "@/components/AssignmentChain";
import { StageStrip } from "@/components/StageStrip";
import { SpecSheet } from "@/components/SpecSheet";
import { ReferenceGallery } from "@/components/ReferenceGallery";
import { SmartImage } from "@/components/SmartImage";
import { RowActions } from "@/components/RowActions";
import { garmentPath } from "@/components/GarmentCard";
import { useAuth } from "@/context/AuthContext";
import { isManagerRole, canSee, canWriteOrders } from "@/lib/roles";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import clsx from "clsx";

export function GarmentPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const { user } = useAuth();
  const [details, setDetails] = useState<ScanDetails | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"make" | "images" | "customer">("make");
  const hydrated = useRef(false);

  const load = useCallback(async () => {
    if (!itemId) return;
    try {
      const data = await apiJson<ScanDetails>(`/api/order-items/${itemId}/scan-details`);
      hydrated.current = true;
      setDetails(data);
      setErr(null);
    } catch (e) {
      if (!hydrated.current) setErr(e instanceof ApiError ? e.message : "Failed to load garment");
    }
  }, [itemId]);

  useEffect(() => {
    hydrated.current = false;
    setDetails(null);
    setErr(null);
  }, [itemId]);

  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, 20000);

  function printLabel() {
    if (!details?.item._id) return;
    const token = authToken();
    const url = `${apiBaseUrl()}/api/order-items/${details.item._id}/barcode-label`;
    const w = window.open("about:blank");
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob())
      .then((blob) => {
        const href = URL.createObjectURL(blob);
        if (w) w.location.href = href;
        else window.location.href = href;
      })
      .catch(() => w?.close());
  }

  if (err && !details) return <ErrorState message={err} />;
  if (!details) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const assignment = details.production?.assignment;
  const worker = assignment?.staff;
  const next = details.production?.nextAction;
  const board = details.production?.boardStatus || "waiting";
  const barcode = details.item.labelBarcode || details.item.barcodeValue || "";
  const scanTo = barcode ? `/scan?barcode=${encodeURIComponent(barcode)}` : "/scan";
  const manager = isManagerRole(user?.role);
  const canLabels = canSee(user?.role, "labels");
  const paid = details.pricing.depositPaid;
  const remaining = details.pricing.balanceRemaining;

  return (
    <div className="space-y-6 pb-24 sm:pb-8">
      <PageHeader
        title={details.item.clothingType}
        description={`${details.customer?.name || "—"} · ${shortOrderId(details.order.orderId)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to={scanTo}>
              <Button>Open scanner</Button>
            </Link>
            <RowActions
              actions={[
                { label: "Print label", hidden: !canLabels, onClick: printLabel },
                { label: "View order", to: `/orders/${encodeURIComponent(details.order.orderId)}` },
                {
                  label: "Edit order",
                  hidden: !canWriteOrders(user?.role),
                  to: `/orders/${encodeURIComponent(details.order.orderId)}/edit`
                },
                {
                  label: "Set assignment path",
                  hidden: !manager,
                  to: "/distribution"
                }
              ]}
            />
          </div>
        }
      />

      {err && <ErrorState message={err} />}

      {details.order.siblingItems.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {details.order.siblingItems.map((s) => (
            <Link
              key={s._id}
              to={garmentPath(s._id)}
              className={clsx(
                "whitespace-nowrap rounded-control px-3 py-2 text-sm",
                s.isCurrent ? "bg-accent text-white" : "bg-surface text-ink ring-1 ring-line"
              )}
            >
              {s.clothingType}
            </Link>
          ))}
        </div>
      )}

      <section className="ui-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3">
            {details.item.images?.[0]?.imageUrl ? (
              <SmartImage
                src={details.item.images[0].imageUrl}
                alt=""
                className="h-16 w-16 shrink-0 rounded-control object-cover sm:h-20 sm:w-20"
              />
            ) : null}
            <div className="min-w-0">
              <p className="ui-label">Customer</p>
              {details.customer?._id ? (
                <Link to={`/customers/${details.customer._id}`} className="mt-1 block text-xl font-semibold text-ink hover:text-accent">
                  {details.customer.name}
                </Link>
              ) : (
                <p className="mt-1 text-xl font-semibold text-ink">{details.customer?.name || "—"}</p>
              )}
              <p className="text-sm text-ink-muted">{details.customer?.phone}</p>
            </div>
          </div>
          <div className="w-40">
            {barcode && <BarcodeImage value={barcode} className="barcode-mark" />}
            <p className="mt-1 text-center font-mono text-[11px] tracking-wide text-ink-muted">{barcode}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="ui-label">Current stage</p>
            <p className="mt-1 text-lg font-semibold capitalize text-ink">
              {stageLabel(details.timing.currentStage || details.timing.nextExpectedStage)}
            </p>
            <p className="text-xs capitalize text-ink-muted">
              {details.production?.location || `Next ${stageLabel(details.timing.nextExpectedStage)}`}
            </p>
          </div>
          <div>
            <p className="ui-label">Worker</p>
            <p className="mt-1 text-lg font-semibold text-ink">{worker?.name || "Unassigned"}</p>
            <p className="text-xs text-ink-muted">
              Next {details.production?.nextWorker?.name || "—"}
            </p>
            <p className="text-xs text-ink-muted">
              {assignment?.receivedAt
                ? "Assigned — not the same as busy"
                : assignment?.distributedAt
                  ? "Handed over — not received"
                  : assignment
                    ? "Assigned — queued, not busy"
                    : "Waiting for assignment"}
            </p>
          </div>
          <div>
            <p className="ui-label">Due</p>
            <p className={clsx("mt-1 text-lg font-semibold", details.timing.overdue && "text-red-700")}>
              {daysLabel(details.timing.daysRemaining, details.timing.overdue)}
            </p>
            <p className="text-xs text-ink-muted">{formatDate(details.timing.requiredCompletionDate, true)}</p>
          </div>
          <div>
            <p className="ui-label">Payment</p>
            <p className="mt-1 text-lg font-semibold tabular text-ink">{formatMoney(remaining)} due</p>
            <p className="text-xs text-ink-muted">
              Paid {formatMoney(paid)} of {formatMoney(details.pricing.totalAgreedPrice)}
            </p>
          </div>
        </div>

        {details.production?.stageStates?.length ? (
          <div className="mt-5 border-t border-line pt-4">
            <StageStrip
              stages={details.production.stageStates.map((s) => s.stage)}
              current={details.timing.currentStage || details.timing.nextExpectedStage}
            />
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge
            tone={
              details.timing.overdue ? "urgent" : board === "in_progress" ? "progress" : board === "waiting" ? "warn" : "ok"
            }
          >
            {boardStatusLabel(board)}
          </Badge>
          {details.order.priority && details.order.priority !== "NORMAL" && (
            <Badge tone={details.order.priority === "VIP" ? "accent" : "warn"}>{details.order.priority}</Badge>
          )}
          {assignment?.stage && (
            <span className="text-xs capitalize text-ink-muted">
              {stageLabel(assignment.stage)}
              {handoverLabel(
                assignment.receivedAt ? "received" : assignment.distributedAt ? "handed_over" : "assigned"
              )
                ? ` · ${handoverLabel(
                    assignment.receivedAt ? "received" : assignment.distributedAt ? "handed_over" : "assigned"
                  )}`
                : ""}
            </span>
          )}
        </div>
      </section>

      <section className="space-y-3">
        {next?.code === "assign" && manager && (
          <p className="rounded-control bg-canvas px-3 py-2 text-sm text-ink-muted">
            Assignment is planned on Distribution. Physical movement uses the scanner.
            <Link to="/distribution" className="ml-1 font-semibold text-accent">
              Open distribution
            </Link>
          </p>
        )}
        {next?.code === "assign" && !manager && (
          <p className="rounded-control bg-canvas px-3 py-2 text-sm text-ink-muted">
            Waiting for assignment at {stageLabel(next.stage)}. Ask a manager to assign a worker.
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link to={scanTo} className="block w-full sm:w-auto">
            <Button size="lg" className="min-h-12 w-full">
              {next?.code === "check_out"
                ? `Scan out · ${stageLabel(next.stage)}`
                : next?.code === "check_in" || next?.code === "start_first"
                  ? `Scan in${next?.stage ? ` · ${stageLabel(next.stage)}` : ""}`
                  : "Take to scanner"}
            </Button>
          </Link>
        </div>
        <p className="text-xs text-ink-muted">
          This page is the garment passport. Scan in and scan out happen on the scanner — assigned does not mean busy.
        </p>
      </section>

      <section className="ui-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-ink">Production</h2>
        <div className="mt-4">
          <ProductionTimeline orderItemId={details.item._id} stages={details.production?.stageStates} />
        </div>
      </section>

      {manager && details.item._id && (
        <AssignmentChain orderItemId={details.item._id} scan={details} onSaved={load} />
      )}

      <div className="flex gap-2">
        {(
          [
            ["make", "Specifications"],
            ["images", "Reference"],
            ["customer", "Customer"]
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              tab === key
                ? "rounded-control bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent"
                : "rounded-control px-3 py-1.5 text-sm text-ink-muted hover:bg-canvas"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "make" && (
        <section className="ui-card p-4 sm:p-5">
          <SpecSheet item={details.item} />
        </section>
      )}
      {tab === "images" && (
        <section className="ui-card p-4 sm:p-5">
          <ReferenceGallery images={details.item.images || []} />
        </section>
      )}
      {tab === "customer" && (
        <section className="ui-card space-y-3 p-4 sm:p-5 text-sm">
          <p className="font-semibold text-ink">{details.customer?.name || "Walk-in"}</p>
          <p className="text-ink-muted">{details.customer?.phone}</p>
          {details.customer?.email && <p className="text-ink-muted">{details.customer.email}</p>}
          {details.customer?._id && (
            <Link to={`/customers/${details.customer._id}`} className="inline-block font-semibold text-accent hover:underline">
              Full customer history
            </Link>
          )}
          {canWriteOrders(user?.role) && details.customer?._id && (
            <Link
              to={`/orders/new?customerId=${details.customer._id}`}
              className="block text-sm font-semibold text-accent hover:underline"
            >
              New order for this customer
            </Link>
          )}
        </section>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/95 p-3 backdrop-blur sm:hidden">
        <Link to={scanTo}>
          <Button size="lg" className="min-h-12 w-full">
            {next?.code === "done" ? "Open scanner" : next?.label || "Scan garment"}
          </Button>
        </Link>
      </div>
    </div>
  );
}
