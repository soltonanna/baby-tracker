import type { Request, RequestHandler } from 'express';
import type {
  BabyEventListResponse,
  BabyEventResponse,
  CreateBabyEventInput,
  ListBabyEventsQuery,
  UpdateBabyEventInput,
} from '@baby-tracker/shared';
import { getFamilyScope } from '../../middleware/familyAccess.js';
import { getBabyScope } from '../../middleware/babyAccess.js';
import { validatedQuery } from '../../middleware/validate.js';
import * as eventService from './service.js';

/**
 * Express 5 types a route parameter as string | string[]; anything that is not a
 * plain string is not an id, and the service answers 404 for it.
 */
const eventIdOf = (req: Request): string =>
  typeof req.params.eventId === 'string' ? req.params.eventId : '';

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
  const event = await eventService.getEvent(getFamilyScope(req), getBabyScope(req), eventIdOf(req));

  res.status(200).json({ event } satisfies BabyEventResponse);
};

export const update: RequestHandler = async (req, res) => {
  const event = await eventService.updateEvent(
    getFamilyScope(req),
    getBabyScope(req),
    eventIdOf(req),
    req.body as UpdateBabyEventInput,
  );

  res.status(200).json({ event } satisfies BabyEventResponse);
};

/** 204 with no body, the same shape logout uses for a success that has nothing to say. */
export const remove: RequestHandler = async (req, res) => {
  await eventService.deleteEvent(getFamilyScope(req), getBabyScope(req), eventIdOf(req));

  res.status(204).send();
};
