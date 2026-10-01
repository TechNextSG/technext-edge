/* Contract tests: the assumptions bff/ and ai/ are allowed to make about Phillip's API.
 *
 * These run against the PINNED spec, not staging. They are the tripwire for a spec refresh:
 * `npm run spec:pull` brings in a change, these go red, and the PR has to state what moved.
 * Phillip has already been asked to change five things (see odoo/SOURCE.md), so red here is
 * expected at some point — the point is that it is never silent.
 */
import { describe, expect, it } from 'vitest';
import spec from '../odoo/estimate-api.v1.json' with { type: 'json' };

const schemas = spec.components.schemas as Record<string, any>;

describe('paths the BFF routes onto', () => {
  it.each([
    ['get', '/v1/health'],
    ['get', '/v1/estimate/rates'],
    ['get', '/v1/estimate/rooms'],
    ['post', '/v1/estimate/compute'],
    ['post', '/v1/booking/submit'],
    // In the pinned spec since the 30/09 re-pin; the BFF already called them (odoo-auth.ts, estimate.ts boats()).
    ['get', '/v1/estimate/boats'],
    ['post', '/v1/auth/login'],
    ['post', '/v1/auth/register'],
    ['post', '/v1/auth/logout'],
    ['post', '/v1/auth/forgot-password'],
    ['get', '/v1/auth/me'],
  ])('%s %s exists', (method, path) => {
    expect((spec.paths as Record<string, any>)[path]?.[method]).toBeDefined();
  });

  it('has no path the pinned copy does not know about', () => {
    expect(Object.keys(spec.paths).sort()).toEqual([
      '/v1/auth/forgot-password',
      '/v1/auth/login',
      '/v1/auth/logout',
      '/v1/auth/me',
      '/v1/auth/register',
      '/v1/booking/submit',
      '/v1/estimate/boats',
      '/v1/estimate/compute',
      '/v1/estimate/pricelists',
      '/v1/estimate/rates',
      '/v1/estimate/rates/manifest',
      '/v1/estimate/rooms',
      '/v1/guest/lookup',
      '/v1/health',
      '/v1/inquiry',
      '/v1/inquiry/submit',
      '/v1/inquiry/{lead_id}',
      '/v1/inquiry/{lead_id}/quoted',
    ]);
  });
});

describe('auth Phillip documented (was a "six items for v1" gap until the 30/09 re-pin)', () => {
  // The BFF sends the key in header `api-key` (CLAUDE.md §5). If the spec renames it, this goes red.
  it('declares an apiKey security scheme in header "api-key"', () => {
    const schemes = Object.values((spec.components as any).securitySchemes ?? {}) as any[];
    expect(schemes.length).toBeGreaterThan(0);
    for (const scheme of schemes) {
      expect(scheme).toMatchObject({ type: 'apiKey', in: 'header', name: 'api-key' });
    }
  });
});

describe('Trip, the schema the extractor must produce', () => {
  // ai/ fills these in from a guest message. A rename breaks extraction silently at runtime,
  // so it has to break the build here instead.
  it.each([
    'guestType', 'transportType', 'checkIn', 'checkOut',
    'diveFrom', 'diveTo', 'rooms', 'guests', 'items',
  ])('keeps field %s', (field) => {
    expect(schemas.Trip.properties).toHaveProperty(field);
  });

  it('keeps the guest fields the extractor sets', () => {
    expect(Object.keys(schemas.Guest.properties)).toEqual(
      expect.arrayContaining(['name', 'diver', 'meals', 'transport', 'roomId', 'arrive', 'depart']),
    );
  });

  it('keeps the enum values the UI offers', () => {
    expect(schemas.GuestType.enum).toEqual(['retail', 'agent', 'instructor']);
    expect(schemas.TransportType.enum).toEqual(['none', 'roundtrip', 'oneway']);
    expect(schemas.RoomType.enum).toEqual(['standard', 'deluxe', 'suite']);
  });
});

describe('request and response shapes the BFF depends on', () => {
  it('compute takes a trip and returns role + model', () => {
    expect(schemas.ComputeRequest.required).toContain('trip');
    expect(schemas.ComputeResponse.required).toEqual(expect.arrayContaining(['role', 'model']));
  });

  it('submit takes contact + trip and returns success', () => {
    expect(schemas.SubmitRequest.required).toEqual(expect.arrayContaining(['contact', 'trip']));
    expect(schemas.SubmitContact.required).toEqual(expect.arrayContaining(['name', 'email']));
    expect(schemas.SubmitResponse.required).toContain('success');
  });

  it('submit carries certificates, transfer leg and diet notes in one call (29/09 spec)', () => {
    // The QC-readiness plan folds these into the single submit (R18); a rename here breaks the bundle.
    expect(schemas.SubmitRequest.properties.attachments).toMatchObject({ type: 'array', maxItems: 40 });
    expect(schemas.SubmitAttachment.required).toEqual(
      expect.arrayContaining(['guest_name', 'filename', 'mimetype', 'data_b64']),
    );
    expect(schemas.TransferDirection.enum).toEqual(['arrival', 'departure']);
    expect(schemas.Trip.properties).toHaveProperty('transferDirection');
    expect(Object.keys(schemas.Guest.properties)).toEqual(
      expect.arrayContaining(['transferDirection', 'diet', 'allergies']),
    );
  });

  it('EstimateModel still carries the keys the estimator page reads', () => {
    // These five are what Sky's calc() returns and what the HTML tool renders. The differential
    // test compares them number by number, so a rename is a blocker, not a cosmetic change.
    expect(Object.keys(schemas.EstimateModel.properties)).toEqual(
      expect.arrayContaining(['catRev', 'gwin', 'presence', 'vanRuns', 'kpis']),
    );
  });
});

describe('gaps that are open with Phillip', () => {
  // Each of these is a "six items for v1" request. When one starts passing the wrong way round,
  // Phillip has shipped it: delete the test, use the feature, update odoo/SOURCE.md.
  it('compute still returns no rates_version, so snapshots cannot prove a price', () => {
    expect(schemas.ComputeResponse.properties).not.toHaveProperty('rates_version');
  });

  it('submit still takes no Idempotency-Key, so the BFF must dedupe on its own', () => {
    const params = (spec.paths['/v1/booking/submit'] as any).post.parameters ?? [];
    expect(params.map((p: any) => p.name)).not.toContain('Idempotency-Key');
  });
});
