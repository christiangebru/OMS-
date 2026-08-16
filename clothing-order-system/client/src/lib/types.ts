export type UserRole =
  | "admin"
  | "manager"
  | "reception"
  | "cutter"
  | "tailor"
  | "embroiderer"
  | "finisher"
  | "packer"
  | "delivery";

export type NeckType = "V-shape" | "square" | "oval";
export type HandType = "wide" | "normal";
export type SizeCategory = "adult" | "kids" | "baby";
export type ProductionStatus =
  | "pending"
  | "cutting"
  | "stitching"
  | "finishing"
  | "completed"
  | "delivered";

export type ProductionStage =
  | "RECEIVED"
  | "CUTTING"
  | "SEWING"
  | "EMBROIDERY"
  | "FINISHING"
  | "READY"
  | "DELIVERED";

export type OrderPriority = "NORMAL" | "RUSH" | "VIP";

export type StaffRole = "TAILOR" | "EMBROIDERER" | "FINISHER" | "CUTTER" | "MANAGER";
export type StaffStatus = "AVAILABLE" | "BUSY" | "OFF_DUTY";

export interface OrderItemImage {
  _id?: string;
  orderItemId?: string;
  imageUrl: string;
  caption?: string;
  category?: string;
  sortOrder?: number;
  uploadedAt?: string;
}

export interface StageCheckpoint {
  _id: string;
  orderItemId: string;
  stage: ProductionStage;
  checkedInAt: string;
  checkedInByStaffId?: string | null;
  checkedOutAt?: string | null;
  checkedOutByStaffId?: string | null;
  notes?: string;
}

export interface OrderItem {
  _id?: string;
  clothingCode: string;
  clothingType: string;
  fabricType: string;
  color: string;
  quantity: number;
  notes: string;
  neckType: NeckType;
  handType: HandType;
  size: SizeCategory;
  /** @deprecated use images */
  imagePath?: string;
  images?: OrderItemImage[];
  productionDays: number;
  unitPrice: number;
  lineTotal?: number;
  difficultyLevel?: number;
  barcodeValue?: string;
  barcodeGeneratedAt?: string;
  stageCheckpoints?: StageCheckpoint[];
  measurements?: {
    gender: "female" | "male" | "kids";
    vest?: string;
    height?: string;
    breast?: string;
    waist?: string;
    shoulder?: string;
    arm?: string;
    chest?: string;
  };
  currentStage?: ProductionStage | null;
  nextStage?: ProductionStage | null;
  boardStatus?: "waiting" | "assigned" | "distributed" | "received" | "in_progress" | null;
  workerName?: string | null;
}

export interface CustomerSummary {
  _id: string;
  name: string;
  phone: string;
  secondaryPhone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

export interface Order {
  _id: string;
  orderId: string;
  customerId?: string;
  customer?: CustomerSummary | null;
  /** Hydrated convenience fields */
  customerName: string;
  customerPhone: string;
  items: OrderItem[];
  groupCode?: string;
  requiredCompletionDate: string;
  estimatedProductionCompletion?: string;
  productionStatus: ProductionStatus;
  priority?: OrderPriority;
  totalAgreedPrice?: number;
  depositPaid?: number;
  balanceRemaining?: number;
  totalRevenue?: number;
  barcodeValue?: string;
  barcodeGeneratedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Measurement {
  _id: string;
  customerId: string;
  category?: string;
  chest?: number;
  waist?: number;
  hip?: number;
  shoulder?: number;
  sleeveLength?: number;
  inseam?: number;
  neck?: number;
  notes?: string;
  fields?: Record<string, string | number | null>;
  recordedAt: string;
}

export interface Customer extends CustomerSummary {
  orderCount?: number;
  lastOrderDate?: string | null;
  outstandingBalance?: number;
  activeGarmentCount?: number;
  createdAt?: string;
  updatedAt?: string;
  measurements?: Measurement[];
  orders?: Array<{
    _id: string;
    orderId: string;
    productionStatus: ProductionStatus;
    priority?: OrderPriority;
    totalAgreedPrice?: number;
    depositPaid?: number;
    requiredCompletionDate: string;
    createdAt: string;
    items?: OrderItem[];
  }>;
}

export interface Staff {
  _id: string;
  name: string;
  phone: string;
  role: StaffRole;
  status: StaffStatus;
  skillLevel: number;
  active: boolean;
  skills?: ProductionStage[];
  skillDetails?: Array<{ stage: ProductionStage; level: number }>;
  createdAt?: string;
  activeAssignmentCount?: number;
  completedAssignmentCount?: number;
  overdueAssignmentCount?: number;
  strongestStage?: ProductionStage | null;
  strongestLevel?: number;
  presence?: "idle" | "assigned" | "handed_over" | "received" | "in_progress";
  currentGarment?: {
    clothingType: string;
    barcodeValue: string;
    stage: string;
    customerName: string | null;
    orderId: string;
  } | null;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface DashboardSummary {
  totalOrders: number;
  completedOrders: number;
  delayedOrders: number;
  totalRevenue: number;
  byStatus: Record<string, number>;
  byClothingType: Record<string, number>;
  mostOrderedClothingType: { type: string; quantity: number } | null;
}

export const PRODUCTION_STAGES: ProductionStage[] = [
  "RECEIVED",
  "CUTTING",
  "SEWING",
  "EMBROIDERY",
  "FINISHING",
  "READY",
  "DELIVERED"
];

export interface ScanDetails {
  customer: CustomerSummary | null;
  item: {
    _id: string;
    clothingCode: string;
    clothingType: string;
    fabricType: string;
    color: string;
    size: string;
    neckType: string;
    handType: string;
    notes: string;
    quantity: number;
    measurements?: OrderItem["measurements"];
    difficultyLevel?: number;
    barcodeValue?: string;
    unitPrice?: number;
    images: OrderItemImage[];
  };
  group: {
    groupCode: string;
    otherOrdersSharingGroup: number;
    otherItemsSharingGroup: number;
  };
  order: {
    orderId: string;
    _id: string;
    productionStatus: ProductionStatus;
    priority?: OrderPriority;
    createdAt?: string;
    siblingItems: Array<{
      _id: string;
      clothingType: string;
      clothingCode: string;
      barcodeValue?: string;
      currentStage: ProductionStage | null;
      isCurrent: boolean;
    }>;
  };
  pricing: {
    totalAgreedPrice: number;
    depositPaid: number;
    balanceRemaining: number;
  };
  timing: {
    requiredCompletionDate: string;
    daysRemaining: number | null;
    overdue: boolean;
    currentStage: ProductionStage | null;
    nextExpectedStage: ProductionStage;
    stageSequence: ProductionStage[];
  };
  production?: {
    action: "check_in" | "check_out";
    actionStage: ProductionStage;
    boardStatus?: "waiting" | "assigned" | "distributed" | "received" | "in_progress";
    nextAction?: { code: string; label: string; stage: ProductionStage };
    stageStates: StageState[];
    assignment?: {
      _id: string;
      stage: string;
      assignedAt: string;
      distributedAt?: string | null;
      receivedAt?: string | null;
      staff?: { _id: string; name: string; role: string; status: string } | null;
    } | null;
  };
}

export interface StaffRanking {
  staff: {
    _id: string;
    name: string;
    phone: string;
    role: StaffRole;
    status: StaffStatus;
    skillLevel: number;
    activeAssignmentCount: number;
  };
  scores: {
    urgencyScore: number;
    skillMatchScore: number;
    availabilityScore: number;
    priorityScore: number;
    rankedScore: number;
  };
  reason: string;
  reasons?: Array<{ ok: boolean; code: string; label: string }>;
  summary?: string;
}

export interface StageState {
  stage: ProductionStage;
  status: "completed" | "in_progress" | "waiting" | "next" | "skipped" | "blocked";
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  durationMs?: number | null;
  waitingMs?: number | null;
  open?: boolean;
  isCurrent?: boolean;
  overdue?: boolean;
  assigned?: boolean;
  assignedTo?: string | null;
  handoverStatus?: "assigned" | "handed_over" | "received" | null;
  notes?: string;
  checkedInBy?: { _id: string; name: string; role: string } | null;
  checkedOutBy?: { _id: string; name: string; role: string } | null;
}

export interface TimelineEntry {
  _id: string;
  stage: ProductionStage;
  checkedInAt: string;
  checkedOutAt?: string | null;
  notes?: string;
  checkedInBy?: { _id: string; name: string; role: string } | null;
  checkedOutBy?: { _id: string; name: string; role: string } | null;
  durationMs?: number | null;
  open: boolean;
}

export interface ClothingTypeConfig {
  _id: string;
  key: string;
  label: string;
  stageSequence: ProductionStage[];
  includesEmbroidery: boolean;
}

export interface DashboardOperations {
  today: {
    orders: number;
    dueToday: number;
    overdue: number;
    inProduction: number;
    ready: number;
  };
  production: Record<
    string,
    {
      waiting: number;
      assigned: number;
      distributed: number;
      received?: number;
      inProgress: number;
      total: number;
    }
  >;
  distribution: {
    unassigned: number;
    awaitingDistribution: number;
    handedOver?: number;
    received?: number;
    assigned: number;
    inProgress: number;
  };
  staff: { available: number; busy: number; unavailable: number; overloaded: number };
  urgent: Array<{
    orderId: string;
    itemId: string;
    clothingType: string;
    customerName: string;
    nextStage: string;
    priority: string;
    daysRemaining: number | null;
    overdue: boolean;
    boardStatus?: string;
    workerName?: string | null;
    barcodeValue?: string;
  }>;
  floor?: Array<{
    itemId: string;
    barcodeValue: string;
    clothingType: string;
    clothingCode?: string;
    customerName: string;
    orderId: string;
    stage: string | null;
      boardStatus: "waiting" | "assigned" | "distributed" | "received" | "in_progress";
    workerName: string | null;
    overdue: boolean;
    priority: OrderPriority;
    daysRemaining: number | null;
  }>;
  needsAssignment?: Array<{
    itemId: string;
    orderId: string;
    clothingType: string;
    customerName: string;
    nextStage: string;
    barcodeValue?: string;
    daysRemaining: number | null;
    overdue: boolean;
  }>;
  recentlyReceived?: Array<{
    itemId: string;
    orderId: string;
    clothingType: string;
    customerName: string;
    nextStage: string;
    workerName: string | null;
    barcodeValue?: string;
  }>;
}

export interface QueueItem {
  itemId: string;
  barcodeValue: string;
  clothingType: string;
  clothingCode: string;
  difficultyLevel?: number;
  orderId: string;
  productionStatus: ProductionStatus;
  priority: OrderPriority;
  requiredCompletionDate: string;
  daysRemaining: number | null;
  overdue: boolean;
  customer: CustomerSummary | null;
  currentStage: ProductionStage | null;
  nextStage: ProductionStage;
  openStage?: string | null;
  boardStatus: "waiting" | "assigned" | "distributed" | "received" | "in_progress";
  inProgress?: boolean;
  assignment?: {
    _id: string;
    stage: string;
    assignedAt: string;
    distributedAt?: string | null;
    receivedAt?: string | null;
    staff?: { _id: string; name: string; role: string; status: string; skillLevel: number } | null;
  } | null;
  recommended?: StaffRanking | null;
}

export interface ProductionQueue {
  generatedAt: string;
  summary: {
    itemsWaiting: number;
    itemsAssigned: number;
    itemsDistributed: number;
    itemsReceived?: number;
    itemsInProgress: number;
    overdueItems: number;
    todayCreated: number;
    dueToday: number;
    overdueOrders: number;
    inProduction: number;
    ready: number;
  };
  staff: {
    available: number;
    busy: number;
    unavailable: number;
    overloaded: number;
    workers: Staff[];
  };
  byStage: Record<
    string,
    {
      stage: string;
      waiting: number;
      assigned: number;
      distributed: number;
      inProgress: number;
      items: QueueItem[];
    }
  >;
  items: QueueItem[];
}
