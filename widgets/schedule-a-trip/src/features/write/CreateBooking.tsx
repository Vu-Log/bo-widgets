import {
  Alert,
  Autocomplete,
  Box,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@vulog/bo-widget-react';
import { useEffect, useMemo, useState } from 'react';
import { ApiRequestError, unwrap } from '../../api/http';
import { createBookingRequest } from '../../api/schedule-a-trip';
import { getRegistrationOverview, searchCustomers, type CustomerMatch } from '../../api/users';
import { datesProblems, defaultReturn, defaultStart } from '../../domain/booking-dates';
import { buildNewBooking, MAX_NOTES_LENGTH, type NewBookingProblem } from '../../domain/new-booking';
import { bookableProfiles, bookableServices } from '../../domain/booking-profiles';
import { customerName } from '../../domain/customers';
import { useI18n } from '../../i18n';
import { queryKeys } from '../../query/keys';
import { modelsQueryOptions, vehicleCatalogQueryOptions } from '../../query/queries';
import { queryErrorText } from '../core/common';
import { useSection } from '../section-context';
import { WriteDialogFrame } from './dialogs';
import { DateFields, isPickupComplete, PickupFields, type DatesValue, type PickupValue } from './fields';
import { useAfterWrite } from './use-write';

const STEPS = ['create.stepCustomer', 'create.stepTrip', 'create.stepSummary'] as const;

/** The booking to create broke a rule when it was sent (the start passed meanwhile…). */
export class IncompleteBookingError extends Error {
  constructor(readonly problems: readonly NewBookingProblem[]) {
    super(`The booking is incomplete: ${problems.join(', ')}`);
    this.name = 'IncompleteBookingError';
  }
}

/** A text, once it stopped changing for a while. */
function useSettled(text: string, delay = 300): string {
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(text), delay);
    return () => clearTimeout(timer);
  }, [text, delay]);
  return settled;
}

/**
 * Creates a Schedule a trip booking in 3 steps, as the back office does: the customer and one of
 * their profiles; the service (free floating, approved for the profile), the dates, the model and
 * the pickup point; a summary with the notes. The booking then opens in the drawer.
 *
 * @param props - The closing handler.
 * @returns The dialog.
 */
export function CreateBookingDialog({ onClose }: { readonly onClose: () => void }) {
  const { t, formatDateInZone } = useI18n();
  const authFetch = useAuthFetch();
  const { fleetId, timeZone, vehicleSearchRadius, openDetail } = useSection();
  const after = useAfterWrite();
  const [step, setStep] = useState(0);
  const [text, setText] = useState('');
  const settled = useSettled(text).trim();
  const [customer, setCustomer] = useState<CustomerMatch | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [dates, setDates] = useState<DatesValue>(() => {
    const start = defaultStart(new Date());
    return { start, plannedReturn: defaultReturn(start) };
  });
  const [modelId, setModelId] = useState<number | null>(null);
  const [pickup, setPickup] = useState<PickupValue>({ latitude: null, longitude: null, radius: vehicleSearchRadius });
  const [notes, setNotes] = useState('');

  const search = useQuery({
    queryKey: queryKeys.customerSearch(fleetId, settled),
    queryFn: async ({ signal }) => unwrap(await searchCustomers(authFetch, fleetId, settled, signal)),
    enabled: settled.length >= 2,
    staleTime: 60_000,
  });
  const registration = useQuery({
    queryKey: queryKeys.registration(fleetId, customer?.id ?? ''),
    queryFn: async ({ signal }) =>
      unwrap(await getRegistrationOverview(authFetch, fleetId, customer?.id ?? '', signal)),
    enabled: customer !== null,
    staleTime: 60_000,
  });
  const models = useQuery(modelsQueryOptions(authFetch, fleetId));
  const catalog = useQuery(vehicleCatalogQueryOptions(authFetch, fleetId));

  const profiles = useMemo(() => (registration.data ? bookableProfiles(registration.data) : []), [registration.data]);
  const services = useMemo(
    () => (registration.data && profileId ? bookableServices(registration.data, profileId, fleetId) : []),
    [registration.data, profileId, fleetId],
  );
  // Only one choice: take it, as the back office does.
  useEffect(() => {
    if (profiles.length === 1 && profileId === null) setProfileId(profiles[0]?.profileId ?? null);
  }, [profiles, profileId]);
  useEffect(() => {
    if (services.length === 1 && serviceId === null) setServiceId(services[0]?.id ?? null);
  }, [services, serviceId]);
  const service = services.find((candidate) => candidate.id === serviceId) ?? null;
  // The models of the vehicles of the service, as the back office offers them.
  const serviceModels = useMemo(() => {
    const ids = new Set(
      (catalog.data ?? [])
        .filter((vehicle) => serviceId !== null && vehicle.serviceIds.includes(serviceId))
        .flatMap((vehicle) => (vehicle.modelId === null ? [] : [vehicle.modelId])),
    );
    return (models.data ?? []).filter((model) => ids.has(model.id));
  }, [catalog.data, models.data, serviceId]);

  const problems = datesProblems({ ...dates, now: new Date() });
  const built = buildNewBooking(
    {
      userId: customer?.id ?? null,
      profileId,
      service,
      ...dates,
      modelId,
      ...pickup,
      notes,
    },
    new Date(),
  );
  const canGo = [
    customer !== null && profileId !== null,
    service !== null && problems.length === 0 && isPickupComplete(pickup),
    built.ok,
  ];

  const mutation = useMutation({
    mutationFn: async () => {
      // Checked again when sent: the start may have passed while the summary was open.
      const checked = buildNewBooking(
        { userId: customer?.id ?? null, profileId, service, ...dates, modelId, ...pickup, notes },
        new Date(),
      );
      if (!checked.ok) throw new IncompleteBookingError(checked.problems);
      const result = await createBookingRequest(authFetch, fleetId, checked.value);
      if (!result.ok) throw new ApiRequestError(result.error);
      return result.data;
    },
    onSuccess: (bookingId) => {
      after(t('write.created'), bookingId, undefined, [], t);
      onClose();
      openDetail(bookingId);
    },
  });

  const name = (match: CustomerMatch) => {
    const full = customerName({ ...match, profiles: [] }) ?? match.id;
    return match.userName ? `${full} (${match.userName})` : full;
  };
  const last = step === STEPS.length - 1;
  return (
    <WriteDialogFrame
      title={t('create.title')}
      onClose={onClose}
      onSubmit={() => (last ? mutation.mutate() : setStep(step + 1))}
      submitLabel={last ? t('create.submit') : t('create.next')}
      submitting={mutation.isPending}
      error={
        mutation.error instanceof IncompleteBookingError
          ? t('create.incomplete')
          : mutation.error
            ? queryErrorText(mutation.error, t)
            : null
      }
      disabled={!canGo[step]}
      wide
    >
      <Stepper activeStep={step}>
        {STEPS.map((key, index) => (
          <Step key={key} completed={index < step}>
            <StepLabel
              onClick={() => index < step && setStep(index)}
              sx={{ cursor: index < step ? 'pointer' : 'default' }}
            >
              {t(key)}
            </StepLabel>
          </Step>
        ))}
      </Stepper>
      {step === 0 && (
        <Box sx={{ display: 'grid', gap: 2 }}>
          <Autocomplete<CustomerMatch>
            options={search.data ?? []}
            getOptionLabel={name}
            filterOptions={(options) => options}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            loading={search.isFetching}
            value={customer}
            inputValue={text}
            onInputChange={(_, next) => setText(next)}
            onChange={(_, match) => {
              setCustomer(match);
              setProfileId(null);
              setServiceId(null);
              setModelId(null);
            }}
            noOptionsText={search.isError ? queryErrorText(search.error, t) : t('create.noCustomer')}
            renderInput={(params) => <TextField {...params} label={t('create.customer')} autoFocus />}
          />
          {customer && registration.isPending && <Typography color="text.secondary">{t('common.loading')}</Typography>}
          {registration.isError && (
            <Alert severity="error" role="alert">
              {queryErrorText(registration.error, t)}
            </Alert>
          )}
          {customer && registration.isSuccess && profiles.length === 0 && (
            <Alert severity="warning">{t('create.noProfile')}</Alert>
          )}
          {profiles.length > 0 && (
            <RadioGroup
              aria-label={t('customer.profile')}
              value={profileId ?? ''}
              onChange={(event) => {
                setProfileId(event.target.value);
                setServiceId(null);
                setModelId(null);
              }}
            >
              {profiles.map((profile) => (
                <FormControlLabel
                  key={profile.profileId}
                  value={profile.profileId}
                  control={<Radio />}
                  label={profile.type === 'Business' ? t('customer.business') : t('customer.single')}
                />
              ))}
            </RadioGroup>
          )}
        </Box>
      )}
      {step === 1 && (
        <Box sx={{ display: 'grid', gap: 2 }}>
          {services.length === 0 ? (
            <Alert severity="warning">{t('create.noService')}</Alert>
          ) : (
            <TextField
              select
              label={t('create.service')}
              value={serviceId ?? ''}
              onChange={(event) => {
                setServiceId(event.target.value);
                setModelId(null);
              }}
            >
              {services.map((candidate) => (
                <MenuItem key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          <DateFields
            value={dates}
            onChange={setDates}
            errors={{
              start: problems.includes('start-missing')
                ? t('form.startMissing')
                : problems.includes('start-past')
                  ? t('form.startPast')
                  : undefined,
              plannedReturn: problems.includes('return-before-start') ? t('form.returnBeforeStart') : undefined,
            }}
          />
          <TextField
            select
            label={t('vehicle.model')}
            value={modelId === null ? 'any' : String(modelId)}
            onChange={(event) => setModelId(event.target.value === 'any' ? null : Number(event.target.value))}
          >
            <MenuItem value="any">{t('vehicle.anyModel')}</MenuItem>
            {serviceModels.map((model) => (
              <MenuItem key={model.id} value={String(model.id)}>
                {model.name}
              </MenuItem>
            ))}
          </TextField>
          <PickupFields value={pickup} onChange={setPickup} />
        </Box>
      )}
      {step === 2 && customer && service && dates.start && (
        <Box sx={{ display: 'grid', gap: 2 }}>
          <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 1, m: 0 }}>
            {[
              [t('create.customer'), name(customer)],
              [t('create.service'), service.name],
              [t('trip.start'), formatDateInZone(dates.start, 'Pp', timeZone)],
              [
                t('trip.plannedReturn'),
                dates.plannedReturn ? formatDateInZone(dates.plannedReturn, 'Pp', timeZone) : t('trip.noReturnDate'),
              ],
              [
                t('vehicle.model'),
                modelId === null ? t('vehicle.anyModel') : (serviceModels.find((m) => m.id === modelId)?.name ?? `#${modelId}`),
              ],
              [t('trip.address'), `${pickup.latitude?.toFixed(5)}, ${pickup.longitude?.toFixed(5)}`],
              [t('trip.radius'), t('trip.meters', { meters: pickup.radius })],
            ].map(([label, value]) => (
              <Box key={label} sx={{ display: 'contents' }}>
                <Typography component="dt" variant="body2" color="text.secondary">
                  {label}
                </Typography>
                <Typography component="dd" variant="body2" sx={{ m: 0 }}>
                  {value}
                </Typography>
              </Box>
            ))}
          </Box>
          <TextField
            label={t('trip.customerNotes')}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            multiline
            minRows={2}
            error={notes.length > MAX_NOTES_LENGTH}
            helperText={`${notes.length}/${MAX_NOTES_LENGTH}`}
          />
        </Box>
      )}
    </WriteDialogFrame>
  );
}
