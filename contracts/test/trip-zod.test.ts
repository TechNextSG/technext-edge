/* Zod là lớp validate lúc chạy; spec đã pin là sự thật. Test này buộc hai thứ đó
 * khớp nhau. Phillip thêm một field mà quên báo thì test đỏ, không phải Eloa phát hiện. */
import { describe, expect, it } from 'vitest';
import spec from '../odoo/estimate-api.v1.json' with { type: 'json' };
import {
  TripSchema, GuestSchema, RoomSchema, CustomItemSchema, VanMetaSchema, DayPlanEntrySchema,
  GuestTypeSchema, TransportTypeSchema, RoomTypeSchema, CourseTypeSchema, VanSplitSchema,
} from '../src/trip.zod.ts';

const schemas = (spec as unknown as { components: { schemas: Record<string, any> } }).components.schemas;

/* Submit-only fields (spec re-pinned 30/09): deliberately NOT mirrored in TripSchema / GuestSchema,
 * so they never enter TripShape, fillTrip or compute. They are added on the submit call only
 * (toOdooTrip extras, QC-readiness plan R20 / R22). Adding them to zod would widen fillTrip. */
const SUBMIT_ONLY: Record<string, string[]> = {
  Trip: ['transferDirection'],
  Guest: ['transferDirection', 'diet', 'allergies'],
};
const specKeys = (name: string): string[] =>
  Object.keys(schemas[name].properties).filter((k) => !(SUBMIT_ONLY[name] ?? []).includes(k)).sort();
const zodKeys = (s: { shape: Record<string, unknown> }): string[] => Object.keys(s.shape).sort();

describe('zod phản chiếu đúng spec đã pin', () => {
  it.each([
    ['Trip', TripSchema],
    ['Guest', GuestSchema],
    ['Room', RoomSchema],
    ['CustomItem', CustomItemSchema],
    ['VanMeta', VanMetaSchema],
    ['DayPlanEntry', DayPlanEntrySchema],
  ])('%s có đúng các field của spec', (name, schema) => {
    expect(zodKeys(schema as never)).toEqual(specKeys(name));
  });

  it.each(Object.entries(SUBMIT_ONLY))('%s: submit-only fields are in the spec but stripped by zod', (name, fields) => {
    expect(Object.keys(schemas[name].properties)).toEqual(expect.arrayContaining(fields));
    const input = Object.fromEntries(fields.map((f) => [f, f === 'transferDirection' ? 'arrival' : 'x']));
    const parsed = (name === 'Trip' ? TripSchema : GuestSchema).parse(input) as Record<string, unknown>;
    for (const f of fields) expect(parsed).not.toHaveProperty(f);
  });

  it.each([
    ['GuestType', GuestTypeSchema],
    ['TransportType', TransportTypeSchema],
    ['RoomType', RoomTypeSchema],
    ['CourseType', CourseTypeSchema],
    ['VanSplit', VanSplitSchema],
  ])('%s có đúng các giá trị enum của spec', (name, schema) => {
    expect([...(schema as { options: string[] }).options].sort()).toEqual([...schemas[name].enum].sort());
  });
});

describe('mặc định của zod không được tự bịa giá trị nguy hiểm', () => {
  it('parse một object rỗng vẫn để ngày trống, không đoán ngày', () => {
    const trip = TripSchema.parse({});
    expect(trip.checkIn).toBeNull();
    expect(trip.diveFrom).toBeNull();
    expect(trip.guests).toEqual([]);
  });
});
