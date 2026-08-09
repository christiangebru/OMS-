export type UserRole = "admin" | "manager";

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
}

export interface CustomerSummary {
  _id: string;
  name: string;
  phone: string;
  secondaryPhone?: string;
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
  chest?: number;
  waist?: number;
  hip?: number;
  shoulder?: number;
  sleeveLength?: number;
  inseam?: number;
  neck?: number;
  notes?: string;
  recordedAt: string;
}

export interface Customer extends CustomerSummary {
  orderCount?: number;
  lastOrderDate?: string | null;
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
  createdAt?: string;
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
