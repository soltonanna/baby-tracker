import type { RequestHandler } from 'express';
import type {
  BabyListResponse,
  BabyResponse,
  CreateBabyInput,
  UpdateBabyInput,
} from '@baby-tracker/shared';
import { HttpError } from '../../lib/httpError.js';
import { getFamilyScope } from '../../middleware/familyAccess.js';
import * as babyService from './service.js';

export const create: RequestHandler = async (req, res) => {
  const baby = await babyService.createBaby(getFamilyScope(req), req.body as CreateBabyInput);

  res.status(201).json({ baby } satisfies BabyResponse);
};

export const list: RequestHandler = async (req, res) => {
  const babies = await babyService.listBabies(getFamilyScope(req));

  res.status(200).json({ babies } satisfies BabyListResponse);
};

export const getOne: RequestHandler = async (req, res) => {
  // Express 5 types a route parameter as string | string[]; anything that is
  // not a plain string is not an id, and the service answers 404 for it.
  const { babyId } = req.params;
  const baby = await babyService.getBaby(
    getFamilyScope(req),
    typeof babyId === 'string' ? babyId : '',
  );

  res.status(200).json({ baby } satisfies BabyResponse);
};

export const update: RequestHandler = async (req, res) => {
  const { babyId } = req.params;
  const baby = await babyService.updateBaby(
    getFamilyScope(req),
    typeof babyId === 'string' ? babyId : '',
    req.body as UpdateBabyInput,
  );

  res.status(200).json({ baby } satisfies BabyResponse);
};

export const remove: RequestHandler = async (req, res) => {
  const { babyId } = req.params;
  await babyService.deleteBaby(getFamilyScope(req), typeof babyId === 'string' ? babyId : '');

  res.status(204).end();
};

export const putPhoto: RequestHandler = async (req, res) => {
  const { babyId } = req.params;
  // `express.raw` leaves the body untouched when the Content-Type is not an
  // allowed image type, so anything but a Buffer is an unsupported upload.
  if (!Buffer.isBuffer(req.body)) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the image as JPEG, PNG or WebP');
  }
  const baby = await babyService.setBabyPhoto(
    getFamilyScope(req),
    typeof babyId === 'string' ? babyId : '',
    req.body,
  );

  res.status(200).json({ baby } satisfies BabyResponse);
};

export const deletePhoto: RequestHandler = async (req, res) => {
  const { babyId } = req.params;
  const baby = await babyService.removeBabyPhoto(
    getFamilyScope(req),
    typeof babyId === 'string' ? babyId : '',
  );

  res.status(200).json({ baby } satisfies BabyResponse);
};

export const getPhoto: RequestHandler = async (req, res) => {
  const { babyId } = req.params;
  const photo = await babyService.getBabyPhoto(
    getFamilyScope(req),
    typeof babyId === 'string' ? babyId : '',
  );

  // Private to the signed-in caller and revalidated: a replaced photo must
  // show up at once, and a shared cache must never hold a child's picture.
  res
    .status(200)
    .set({ 'Content-Type': photo.contentType, 'Cache-Control': 'private, no-cache' })
    .send(photo.data);
};
