/**
 * Compact operational stats for the staff index (workforce board).
 */
export async function attachStaffBoard(prisma, staffList) {
  const ids = staffList.map((s) => s._id || s.id).filter(Boolean);
  if (!ids.length) return staffList;

  const [activeAsg, completedGroups, openCheckpoints] = await Promise.all([
    prisma.staffAssignment.findMany({
      where: { staffId: { in: ids }, completedAt: null },
      include: { orderItem: true },
      orderBy: { assignedAt: "desc" }
    }),
    prisma.staffAssignment.groupBy({
      by: ["staffId"],
      where: { staffId: { in: ids }, completedAt: { not: null } },
      _count: { _all: true }
    }),
    prisma.stageCheckpoint.findMany({
      where: { checkedInByStaffId: { in: ids }, checkedOutAt: null },
      include: { orderItem: true }
    })
  ]);

  const orderIds = [
    ...new Set(
      [...activeAsg, ...openCheckpoints]
        .map((row) => row.orderItem?.order)
        .filter(Boolean)
    )
  ];
  const orders = orderIds.length
    ? await prisma.order.findMany({
        where: { id: { in: orderIds } },
        include: { customer: true }
      })
    : [];
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const now = new Date();

  const activeByStaff = new Map();
  for (const a of activeAsg) {
    if (!activeByStaff.has(a.staffId)) activeByStaff.set(a.staffId, []);
    activeByStaff.get(a.staffId).push(a);
  }
  const openByStaff = new Map();
  for (const cp of openCheckpoints) {
    if (!openByStaff.has(cp.checkedInByStaffId)) openByStaff.set(cp.checkedInByStaffId, []);
    openByStaff.get(cp.checkedInByStaffId).push(cp);
  }
  const completedMap = new Map(completedGroups.map((r) => [r.staffId, r._count._all]));

  return staffList.map((st) => {
    const id = st._id || st.id;
    const actives = activeByStaff.get(id) || [];
    const opens = openByStaff.get(id) || [];
    const overdueCount = actives.filter((a) => {
      const o = orderById.get(a.orderItem.order);
      if (!o) return false;
      return (
      o.requiredCompletionDate < now && !["completed", "ready_to_pack", "delivered"].includes(o.productionStatus)
      );
    }).length;

    const strongest = [...(st.skillDetails || [])].sort((a, b) => (b.level || 0) - (a.level || 0))[0];

    let presence = "idle";
    let current = null;
    const open = opens[0];
    const asg = actives[0];
    if (open?.orderItem) {
      const o = orderById.get(open.orderItem.order);
      presence = "in_progress";
      current = {
        clothingType: open.orderItem.clothingType,
        barcodeValue: open.orderItem.barcodeValue,
        stage: open.stage,
        customerName: o?.customer?.name || null,
        orderId: open.orderItem.orderId
      };
    } else if (asg?.orderItem) {
      presence = asg.receivedAt ? "received" : asg.distributedAt ? "handed_over" : "assigned";
      const o = orderById.get(asg.orderItem.order);
      current = {
        clothingType: asg.orderItem.clothingType,
        barcodeValue: asg.orderItem.barcodeValue,
        stage: asg.stage,
        customerName: o?.customer?.name || null,
        orderId: asg.orderItem.orderId
      };
    }

    return {
      ...st,
      activeAssignmentCount: actives.length,
      completedAssignmentCount: completedMap.get(id) || 0,
      overdueAssignmentCount: overdueCount,
      strongestStage: strongest?.stage || null,
      strongestLevel: strongest?.level || st.skillLevel || 3,
      presence,
      currentGarment: current
    };
  });
}
