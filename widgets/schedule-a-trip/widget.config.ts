import { defineWidgetConfig } from '@vulog/bo-widget-vite';
import { loadEnv } from 'vite';
import { devOverrides } from './dev-env.ts';

// The fleet and settings of a real back office come from the environment or `.env.local` (dev-env.ts), never from
// this public file. Not under Vitest: a developer's `.env.local` must not change the tests.
const devEnv = devOverrides(process.env.VITEST ? {} : loadEnv('development', import.meta.dirname, 'BO_WIDGET_'));

/** A booking of the mock answers, with neutral values. */
const sampleBooking = (id: string, status: string, userId: string, startDate: string) => ({
  id,
  status,
  creationDate: '2026-01-01T09:00:00Z',
  startDate,
  plannedReturnDate: startDate.replace(/T\d\d/, 'T18'),
  userId,
  profileId: 'profile-1',
  serviceId: 'service-1',
  modelId: 7,
  latitude: 48.8566,
  longitude: 2.3522,
  radius: 500,
});

// The manifest of the widget (widget.json). The id, version and description come from package.json.
// The settings are filled in by an administrator at installation (Configuration > Widgets), and
// read with getSettings(): never put a secret in them, the widget code runs in the browser.
export default defineWidgetConfig({
  name: 'Schedule a trip',
  entry: 'src/main.tsx',
  // apiInfo: Vulog API calls through authFetch. storage: the state of each booking (bo.storage).
  permissions: ['apiInfo', 'storage', 'notify', 'navigate'],
  // Labels in the 8 languages of the widget (LANGUAGES of src/i18n.ts): the product name is kept.
  menu: {
    label: {
      en: 'Schedule a trip',
      de: 'Schedule a trip',
      fr: 'Schedule a trip',
      it: 'Schedule a trip',
      nl: 'Schedule a trip',
      es: 'Schedule a trip',
      pt: 'Schedule a trip',
      hu: 'Schedule a trip',
    },
  },
  settings: [
    {
      key: 'prepaymentProductId',
      type: 'string',
      required: true,
      label: {
        en: 'Prepayment product id',
        de: 'ID des Vorauszahlungsprodukts',
        fr: 'Id du produit de prépaiement',
        it: 'ID del prodotto di prepagamento',
        nl: 'ID van het vooruitbetalingsproduct',
        es: 'ID del producto de prepago',
        pt: 'ID do produto de pré-pagamento',
        hu: 'Előrefizetési termék azonosítója',
      },
    },
    {
      key: 'cancellationFeesProductId',
      type: 'string',
      required: true,
      label: {
        en: 'Cancellation fees product id',
        de: 'ID des Produkts für Stornogebühren',
        fr: 'Id du produit des frais d’annulation',
        it: 'ID del prodotto delle penali di annullamento',
        nl: 'ID van het product voor annuleringskosten',
        es: 'ID del producto de gastos de cancelación',
        pt: 'ID do produto das taxas de cancelamento',
        hu: 'Lemondási díj termékazonosítója',
      },
    },
    {
      key: 'dayRate',
      type: 'number',
      required: true,
      label: {
        en: 'Day rate',
        de: 'Tagessatz',
        fr: 'Tarif journalier',
        it: 'Tariffa giornaliera',
        nl: 'Dagtarief',
        es: 'Tarifa diaria',
        pt: 'Tarifa diária',
        hu: 'Napi díj',
      },
    },
    {
      key: 'ratio',
      type: 'number',
      required: true,
      label: {
        en: 'Ratio applied to the day rate',
        de: 'Auf den Tagessatz angewandter Faktor',
        fr: 'Coefficient appliqué au tarif journalier',
        it: 'Coefficiente applicato alla tariffa giornaliera',
        nl: 'Factor toegepast op het dagtarief',
        es: 'Coeficiente aplicado a la tarifa diaria',
        pt: 'Coeficiente aplicado à tarifa diária',
        hu: 'A napi díjra alkalmazott szorzó',
      },
    },
    {
      key: 'minimumAmount',
      type: 'number',
      required: true,
      label: {
        en: 'Minimum prepayment amount',
        de: 'Mindestbetrag der Vorauszahlung',
        fr: 'Montant minimum du prépaiement',
        it: 'Importo minimo del prepagamento',
        nl: 'Minimumbedrag van de vooruitbetaling',
        es: 'Importe mínimo del prepago',
        pt: 'Valor mínimo do pré-pagamento',
        hu: 'Minimális előrefizetési összeg',
      },
    },
    {
      key: 'refundFullHours',
      type: 'number',
      default: 24,
      label: {
        en: 'Full refund when cancelled at least this many hours before the start',
        de: 'Volle Erstattung bei Stornierung mindestens so viele Stunden vor Beginn',
        fr: 'Remboursement complet si l’annulation a lieu au moins ce nombre d’heures avant le départ',
        it: 'Rimborso completo se annullata con almeno questo numero di ore di anticipo',
        nl: 'Volledige terugbetaling bij annulering minstens zoveel uur vóór de start',
        es: 'Reembolso completo si se cancela con al menos este número de horas de antelación',
        pt: 'Reembolso total se cancelada com pelo menos este número de horas de antecedência',
        hu: 'Teljes visszatérítés, ha legalább ennyi órával a kezdés előtt mondják le',
      },
    },
    {
      key: 'creditsRevokeHours',
      type: 'number',
      default: 1,
      label: {
        en: 'Credits revoked when cancelled less than this many hours before the start',
        de: 'Guthaben entzogen bei Stornierung weniger als so viele Stunden vor Beginn',
        fr: 'Crédits révoqués si l’annulation a lieu moins de ce nombre d’heures avant le départ',
        it: 'Crediti revocati se annullata con meno di questo numero di ore di anticipo',
        nl: 'Tegoed ingetrokken bij annulering minder dan zoveel uur vóór de start',
        es: 'Créditos revocados si se cancela con menos de este número de horas de antelación',
        pt: 'Créditos revogados se cancelada com menos de este número de horas de antecedência',
        hu: 'Kreditek visszavonása, ha ennél kevesebb órával a kezdés előtt mondják le',
      },
    },
    {
      key: 'vehicleSearchRadius',
      type: 'number',
      default: 500,
      label: {
        en: 'Default vehicle search radius (meters)',
        de: 'Standardradius der Fahrzeugsuche (Meter)',
        fr: 'Rayon par défaut de la recherche de véhicules (mètres)',
        it: 'Raggio predefinito della ricerca veicoli (metri)',
        nl: 'Standaardstraal voor het zoeken naar voertuigen (meter)',
        es: 'Radio predeterminado de búsqueda de vehículos (metros)',
        pt: 'Raio predefinido da pesquisa de veículos (metros)',
        hu: 'Alapértelmezett járműkeresési sugár (méter)',
      },
    },
    {
      key: 'mapboxToken',
      type: 'string',
      required: true,
      label: {
        en: 'Mapbox public token (pk., restricted to the back-office URL)',
        de: 'Öffentlicher Mapbox-Token (pk., auf die Back-Office-URL beschränkt)',
        fr: 'Token public Mapbox (pk., restreint à l’URL du back-office)',
        it: 'Token pubblico Mapbox (pk., limitato all’URL del back office)',
        nl: 'Openbaar Mapbox-token (pk., beperkt tot de back-office-URL)',
        es: 'Token público de Mapbox (pk., restringido a la URL del back office)',
        pt: 'Token público do Mapbox (pk., restrito ao URL do back office)',
        hu: 'Nyilvános Mapbox-token (pk., a back office URL-jére korlátozva)',
      },
    },
    {
      key: 'currency',
      type: 'string',
      label: {
        en: 'Currency (ISO 4217), when the fleet does not give one',
        de: 'Währung (ISO 4217), falls die Flotte keine angibt',
        fr: 'Devise (ISO 4217), si la flotte n’en donne pas',
        it: 'Valuta (ISO 4217), se la flotta non ne indica una',
        nl: 'Valuta (ISO 4217), als de vloot er geen opgeeft',
        es: 'Moneda (ISO 4217), si la flota no indica ninguna',
        pt: 'Moeda (ISO 4217), se a frota não indicar nenhuma',
        hu: 'Pénznem (ISO 4217), ha a flotta nem adja meg',
      },
    },
    {
      key: 'timezone',
      type: 'string',
      label: {
        en: 'Time zone (IANA), when the fleet does not give one',
        de: 'Zeitzone (IANA), falls die Flotte keine angibt',
        fr: 'Fuseau horaire (IANA), si la flotte n’en donne pas',
        it: 'Fuso orario (IANA), se la flotta non ne indica uno',
        nl: 'Tijdzone (IANA), als de vloot er geen opgeeft',
        es: 'Zona horaria (IANA), si la flota no indica ninguna',
        pt: 'Fuso horário (IANA), se a frota não indicar nenhum',
        hu: 'Időzóna (IANA), ha a flotta nem adja meg',
      },
    },
  ],
  // Data of the fake back office in `npm run dev` (mock mode).
  dev: {
    context: { fleetId: devEnv.fleetId ?? 'FLEET-1', locale: 'en_GB' },
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
      ...devEnv.settings,
    },
    // Neutral sample answers of the Vulog API (mock mode): a few bookings of each tab.
    responses: {
      'GET user/scheduleATrip/fleets/FLEET-1/bookingrequests/status/PENDING': [
        sampleBooking('booking-1', 'PENDING', 'user-1', '2027-03-10T08:00:00Z'),
        { ...sampleBooking('booking-2', 'PENDING', 'user-2', '2027-03-11T09:30:00Z'), plannedReturnDate: null },
        { ...sampleBooking('booking-3', 'PENDING', 'user-3', '2027-03-12T14:00:00Z'), modelId: null },
      ],
      'GET user/scheduleATrip/fleets/FLEET-1/bookingrequests/status/ALERT': [
        {
          ...sampleBooking('booking-4', 'ALERT', 'user-1', '2027-03-09T07:00:00Z'),
          failureReason: 'No vehicle available in the radius',
        },
      ],
      'GET user/scheduleATrip/fleets/FLEET-1/bookingrequests/status/CONFIRMED': [
        { ...sampleBooking('booking-5', 'CONFIRMED', 'user-2', '2026-01-10T08:00:00Z'), vehicleId: 'vehicle-1', journeyId: 'trip-1' },
        { ...sampleBooking('booking-6', 'CONFIRMED', 'user-3', '2026-01-05T08:00:00Z'), vehicleId: 'vehicle-2', journeyId: 'trip-2', completed: true, endDate: '2026-01-05T12:00:00Z' },
      ],
      'GET user/scheduleATrip/fleets/FLEET-1/bookingrequests/status/CANCELLED': [
        { ...sampleBooking('booking-7', 'CANCELLED', 'user-1', '2026-02-01T08:00:00Z'), cancellationDate: '2026-01-31T20:00:00Z' },
      ],
      'POST user/fleets/FLEET-1/users/list': [
        { id: 'user-1', firstName: 'Jane', lastName: 'Doe', userName: 'jane.doe', profiles: [{ id: 'profile-1', type: 'Single' }] },
        { id: 'user-2', firstName: 'Alex', lastName: 'Doe', userName: 'alex.doe', profiles: [{ id: 'profile-1', type: 'Business' }] },
        { id: 'user-3', firstName: 'Sam', lastName: 'Doe', userName: 'sam.doe', profiles: [] },
      ],
      'GET user/vehicle/fleets/FLEET-1/vehicles/models': [
        { id: 7, name: 'City car' },
        { id: 8, name: 'Van' },
      ],
      'GET user/vehicle/fleets/FLEET-1/vehicles': [
        { id: 'vehicle-1', name: 'Car 1', plate: 'AA-001-AA', model: { id: 7, name: 'City car' }, serviceIds: ['service-1'] },
        { id: 'vehicle-2', name: 'Car 2', plate: 'AA-002-AA', model: { id: 7, name: 'City car' }, serviceIds: ['service-1'] },
        { id: 'vehicle-3', name: 'Van 1', plate: 'AA-003-AA', model: { id: 8, name: 'Van' }, serviceIds: ['service-1'] },
      ],
      'GET fleetmanager/public/fleets/FLEET-1/vehicles': [
        { id: 'vehicle-1', vehicle_status: 1, location: { latitude: 48.857, longitude: 2.353 }, orderId: 'trip-1' },
        { id: 'vehicle-2', vehicle_status: 0, location: { latitude: 48.8575, longitude: 2.3515 }, energyLevel: 80, autonomy: 210, km: 12000 },
        { id: 'vehicle-3', vehicle_status: 0, location: { latitude: 48.87, longitude: 2.36 }, energyLevel: 55, autonomy: 140, km: 30500 },
      ],
      'GET fleetmanager/public/fleets/FLEET-1/book': [{ id: 'vehicle-1', plate: 'AA-001-AA', orderId: 'trip-1' }],
      // Writes (type "doe" in the customer search of "New booking").
      'GET search/fleets/FLEET-1/search/doe': [
        { type: 'user', id: 'user-1', firstname: 'Jane', lastname: 'Doe', username: 'jane.doe' },
      ],
      'GET user/fleets/FLEET-1/serviceRegistrationOverview': [
        {
          userId: 'user-1',
          catalog: [{ id: 'service-1', name: 'Cars', type: 'FREE_FLOATING', fleetId: 'FLEET-1', cityId: 'city-1' }],
          profiles: [{ profileId: 'profile-1', profileType: 'Single', profileStatus: 'APPROVED', services: { approved: ['service-1'] } }],
        },
      ],
      'GET user/scheduleATrip/fleets/FLEET-1/bookingrequests/users/user-1/active': [],
      'POST user/scheduleATrip/fleets/FLEET-1/bookingrequests': { id: 'booking-1' },
      'POST user/scheduleATrip/fleets/FLEET-1/bookingrequests/booking-1': {},
      'POST user/scheduleATrip/fleets/FLEET-1/bookingrequests/cancel/booking-1': {},
      'POST user/scheduleATrip/fleets/FLEET-1/bookingrequests/booking-1/allocate/vehicle-2': {},
      'POST fleetmanager/public/fleets/FLEET-1/vehicles/vehicle-2/disable': {},
      'POST fleetmanager/public/fleets/FLEET-1/vehicles/vehicle-2/enable': {},
    },
  },
});
