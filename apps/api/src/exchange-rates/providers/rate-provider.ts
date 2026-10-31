export interface FetchedRate {
  source: 'BCV' | 'PARALELO';
  /** Bolívares por 1 USD */
  rate: number;
  /** Momento de actualización que reporta el proveedor, si lo da */
  updatedAt?: string;
}

/** Token de inyección: cambiar de proveedor es registrar otra clase con este token. */
export const RATE_PROVIDER = Symbol('RATE_PROVIDER');

export interface RateProvider {
  readonly name: string;
  fetchLatest(): Promise<FetchedRate[]>;
}
