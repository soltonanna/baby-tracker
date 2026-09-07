import type { RequestHandler } from 'express';
import type {
  BabyEventListResponse,
  BabyEventResponse,
  CreateBabyEventInput,
  ListBabyEventsQuery,
} from '@baby-tracker/shared';
import { getFamilyScope } from '../../middleware/familyAccess.js';
import { getBabyScope } from '../../middleware/babyAccess.js';
import { validatedQuery } from '../../middleware/validate.js';
import * as eventService from './service.js';

export const create: RequestHandler = async (req, res) => {
  const event = await eventService.createEvent(
    getFamilyScope(req),
    getBabyScope(req),
    req.body as CreateBabyEventInput,
  );

  res.status(201).json({ event } satisfies BabyEventResponse);
};

export const list: RequestHandler = async (req, res) => {
  const { limit } = validatedQuery<ListBabyEventsQuery>(res);
  const events = await eventService.listEvents(getFamilyScope(req), getBabyScope(req), limit);

  res.status(200).json({ events } satisfies BabyEventListResponse);
};

export const getOne: RequestHandler = async (req, res) => {
  // Express 5 types a route parameter as string | string[]; anything that is
  // not a plain string is not an id, and the service answers 404 for it.
  const { eventId } = req.params;
  const event = await eventService.getEvent(
    getFamilyScope(req),
    getBabyScope(req),
    typeof eventId === 'string' ? eventId : '',
  );

  res.status(200).json({ event } satisfies BabyEventResponse);
};
