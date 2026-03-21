// core/storage.ts – GM_getValue / GM_setValue wrappers with typed defaults

export interface FeaturesConfig {
  whcDashboard: boolean;
  dateExtractor: boolean;
  deliveryPerf: boolean;
  dvicCheck: boolean;
  dvicShowTransporters: boolean;
  workingHours: boolean;
  returnsDashboard: boolean;
  scorecard: boolean;
}

export interface AppConfig {
  enabled: boolean;
  dev: boolean;
  serviceAreaId: string;
  deliveryPerfStation: string;
  deliveryPerfDsp: string;
  features: FeaturesConfig;
}

export const DEFAULTS: AppConfig = {
  enabled: true,
  dev: false,
  serviceAreaId: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
  deliveryPerfStation: 'XYZ1',
  deliveryPerfDsp: 'TEST',
  features: {
    whcDashboard: true,
    dateExtractor: true,
    deliveryPerf: true,
    dvicCheck: true,
    dvicShowTransporters: true,
    workingHours: true,
    returnsDashboard: true,
    scorecard: true,
  },
};

const CONFIG_KEY = 'ct_config';

export function getConfig(): AppConfig {
  const raw = GM_getValue(CONFIG_KEY, null) as string | null;
  if (!raw) return JSON.parse(JSON.stringify(DEFAULTS)) as AppConfig;
  try {
    const saved: Partial<AppConfig> = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      ...DEFAULTS,
      ...saved,
      features: { ...DEFAULTS.features, ...(saved.features || {}) },
      deliveryPerfStation: saved.deliveryPerfStation || DEFAULTS.deliveryPerfStation,
      deliveryPerfDsp: saved.deliveryPerfDsp || DEFAULTS.deliveryPerfDsp,
    };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULTS)) as AppConfig;
  }
}

export function setConfig(cfg: AppConfig): void {
  GM_setValue(CONFIG_KEY, JSON.stringify(cfg));
}
