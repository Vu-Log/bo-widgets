import { defineWidgetConfig } from '@vulog/bo-widget-vite';

// The manifest of the widget (widget.json). The id, version and description come from package.json.
// The settings are filled in by an administrator at installation (Configuration > Widgets), and
// read with getSettings(): never put a secret in them, the widget code runs in the browser.
export default defineWidgetConfig({
  name: 'Schedule a trip',
  entry: 'src/main.tsx',
  // apiInfo: Vulog API calls through authFetch. storage: the state of each booking (bo.storage).
  permissions: ['apiInfo', 'storage', 'notify', 'navigate'],
  menu: { label: { en: 'Schedule a trip', fr: 'Schedule a trip' } },
  settings: [
    {
      key: 'prepaymentProductId',
      type: 'string',
      required: true,
      label: { en: 'Prepayment product id', fr: 'Id du produit de prépaiement' },
    },
    {
      key: 'cancellationFeesProductId',
      type: 'string',
      required: true,
      label: { en: 'Cancellation fees product id', fr: "Id du produit des frais d'annulation" },
    },
    {
      key: 'dayRate',
      type: 'number',
      required: true,
      label: { en: 'Day rate', fr: 'Tarif journalier' },
    },
    {
      key: 'ratio',
      type: 'number',
      required: true,
      label: {
        en: 'Ratio applied to the day rate',
        fr: 'Coefficient appliqué au tarif journalier',
      },
    },
    {
      key: 'minimumAmount',
      type: 'number',
      required: true,
      label: { en: 'Minimum prepayment amount', fr: 'Montant minimum du prépaiement' },
    },
    {
      key: 'refundFullHours',
      type: 'number',
      default: 24,
      label: {
        en: 'Full refund when cancelled at least this many hours before the start',
        fr: "Remboursement complet si l'annulation a lieu au moins ce nombre d'heures avant le départ",
      },
    },
    {
      key: 'creditsRevokeHours',
      type: 'number',
      default: 1,
      label: {
        en: 'Credits revoked when cancelled less than this many hours before the start',
        fr: "Crédits révoqués si l'annulation a lieu moins de ce nombre d'heures avant le départ",
      },
    },
    {
      key: 'vehicleSearchRadius',
      type: 'number',
      default: 500,
      label: {
        en: 'Default vehicle search radius (meters)',
        fr: 'Rayon par défaut de la recherche de véhicules (mètres)',
      },
    },
    {
      key: 'mapboxToken',
      type: 'string',
      required: true,
      label: { en: 'Public Mapbox token', fr: 'Token Mapbox public' },
    },
    {
      key: 'currency',
      type: 'string',
      label: {
        en: 'Currency (ISO 4217), when the fleet does not give one',
        fr: "Devise (ISO 4217), si la flotte n'en donne pas",
      },
    },
    {
      key: 'timezone',
      type: 'string',
      label: {
        en: 'Time zone (IANA), when the fleet does not give one',
        fr: "Fuseau horaire (IANA), si la flotte n'en donne pas",
      },
    },
  ],
  // Data of the fake back office in `npm run dev` (mock mode).
  dev: {
    context: { fleetId: 'FLEET-1', locale: 'en_GB' },
    user: { fullName: 'Jane Doe' },
    settings: {
      prepaymentProductId: '11111111-1111-4111-8111-111111111111',
      cancellationFeesProductId: '22222222-2222-4222-8222-222222222222',
      dayRate: 100,
      ratio: 1,
      minimumAmount: 10,
      mapboxToken: 'pk.placeholder',
      currency: 'EUR',
      timezone: 'Europe/Paris',
    },
  },
});
