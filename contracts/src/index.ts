export type { paths, components, operations } from './odoo/types.ts';
export { createOdooClient } from './odoo/client.ts';
export type { OdooClient, OdooClientOptions, OdooRole } from './odoo/client.ts';

/** Shorthands for the schemas the BFF and the extractor hand each other. */
import type { components } from './odoo/types.ts';
export type Trip = components['schemas']['Trip'];
export type Guest = components['schemas']['Guest'];
export type Room = components['schemas']['Room'];
export type ComputeRequest = components['schemas']['ComputeRequest'];
export type ComputeResponse = components['schemas']['ComputeResponse'];
export type EstimateModel = components['schemas']['EstimateModel'];
export type SubmitRequest = components['schemas']['SubmitRequest'];
export type SubmitResponse = components['schemas']['SubmitResponse'];
export type SubmitAttachment = components['schemas']['SubmitAttachment'];
export type TransferDirection = components['schemas']['TransferDirection'];
export type RatesResponse = components['schemas']['RatesResponse'];
export type RoomsResponse = components['schemas']['RoomsResponse'];

export * from './trip.zod.ts';
