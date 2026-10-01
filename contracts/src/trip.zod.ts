/* Schema zod của Trip, khai tay theo spec của Phillip. Không sinh tự động: bộ sinh
 * OpenAPI -> zod hiện có tạo ra schema khó đọc, còn Trip thì nhỏ và ít đổi.
 * contracts/test/trip-zod.test.ts là thứ giữ cho khai tay này không trôi khỏi spec. */
import { z } from 'zod';

export const GuestTypeSchema = z.enum(['retail', 'agent', 'instructor']);
export const TransportTypeSchema = z.enum(['none', 'roundtrip', 'oneway']);
export const RoomTypeSchema = z.enum(['standard', 'deluxe', 'suite']);
export const CourseTypeSchema = z.enum(['dsd', 'refresher', 'ow', 'aow', 'rescue']);
export const VanSplitSchema = z.enum(['equal', 'vehicle']);

const str120 = z.string().max(120);

export const DayPlanEntrySchema = z.object({
  dive: z.boolean().default(false),
  third: z.boolean().default(false),
  night: z.boolean().default(false),
  boatId: str120.nullable().default(null),
});

export const RoomSchema = z.object({
  id: str120.nullable().default(null),
  type: RoomTypeSchema.default('standard'),
  name: str120.nullable().default(null),
});

/** UI giữ vanA/vanD là số chỉ xe thứ mấy; spec của Phillip khai chúng là chuỗi maxLength 120,
 *  và gửi số lên là 422. Nhận số ở biên rồi ép về chuỗi ngay, nên TripShape vẫn đúng kiểu của
 *  Odoo. ĐỪNG "sửa lại" thành str120 thuần — làm vậy là dựng lại đúng lỗi 422 đó. */
const vanRef = z.preprocess(
  (value) => (typeof value === 'number' ? String(value) : value),
  str120.nullable(),
).default(null);

export const GuestSchema = z.object({
  id: str120.nullable().default(null),
  name: str120.default('Guest'),
  diver: z.boolean().default(true),
  meals: z.boolean().default(true),
  transport: z.boolean().default(true),
  foc: z.boolean().default(false),
  roomId: str120.nullable().default(null),
  courses: z.array(CourseTypeSchema).max(5).default([]),
  days: z.record(z.string(), DayPlanEntrySchema).default({}),
  arrive: str120.nullable().default(null),
  depart: str120.nullable().default(null),
  comment: z.string().max(500).nullable().default(null),
  vanA: vanRef,
  vanD: vanRef,
});

export const CustomItemSchema = z.object({
  id: str120.nullable().default(null),
  name: str120.nullable().default(null),
  price: z.number().min(0).default(0),
  qty: z.number().min(1).default(1),
  mode: str120.nullable().default(null),
  date: str120.nullable().default(null),
  dateTo: str120.nullable().default(null),
  gids: z.array(z.string()).default([]),
});

export const VanMetaSchema = z.object({
  date: str120.nullable().default(null),
  time: str120.nullable().default(null),
  price: z.number().nullable().default(null),
  foc: z.boolean().default(false),
});

export const TripSchema = z.object({
  label: str120.nullable().default(null),
  guestType: GuestTypeSchema.default('retail'),
  transportType: TransportTypeSchema.default('none'),
  checkIn: str120.nullable().default(null),
  checkOut: str120.nullable().default(null),
  diveFrom: str120.nullable().default(null),
  diveTo: str120.nullable().default(null),
  bookedDaysAhead: z.number().default(0),
  rooms: z.array(RoomSchema).max(30).default([]),
  guests: z.array(GuestSchema).max(40).default([]),
  items: z.array(CustomItemSchema).max(50).default([]),
  vanSplit: VanSplitSchema.nullable().default(null),
  vanMeta: z.record(z.string(), VanMetaSchema).default({}),
  extraDMByDay: z.record(z.string(), z.string()).default({}),
  dmByDay: z.record(z.string(), z.string()).default({}),
});

export type TripShape = z.infer<typeof TripSchema>;
export type GuestShape = z.infer<typeof GuestSchema>;
