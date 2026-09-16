import { Router } from 'express';
import { z } from 'zod';
import { VendorMaster, vendorCode } from './vendorMaster.model.js';
import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { validate } from '../../../core/middleware/validate.js';
import { authenticate, authorize } from '../../../core/middleware/auth.js';
import { CAN_MANAGE } from '../../../core/constants/index.js';

/**
 * The supply vendor master — the standing "who do we buy this from" list.
 *
 * READING is open to any signed-in user, because the pickers need it: the BOQ
 * line and the work order both offer this list when someone chooses a vendor,
 * and the people doing that are ordinary doers. WRITING is manager-and-above,
 * like every other master in the system — one bad edit here changes what every
 * future order can be placed against.
 *
 * DELETE REALLY DELETES, which is the opposite of the game catalogue next door
 * and is a deliberate difference. A retired game has to stay readable because
 * projects reference it and a launch that ran "Mummy" still ran it. Nothing
 * references a row here by id: an order stores the vendor's NAME as text, so
 * removing a supplier from the list leaves every past order reading exactly as
 * it did. A row here is a line in a list of phone numbers, and a list you
 * cannot take a dead number out of stops being trusted.
 */
const body = z.object({
  item: z.string().min(1).max(160),
  vendorName: z.string().min(1).max(200),
  serial: z.number().min(0).nullable().optional(),
  sortOrder: z.number().optional(),
  contactNumber: z.string().max(60).nullable().optional(),
  contactPerson: z.string().max(120).nullable().optional(),
  email: z.string().max(160).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  gst: z.string().max(20).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const idParam = z.object({ params: z.object({ id: z.string().length(24) }) });
const createSchema = z.object({ body });
const updateSchema = z.object({ params: z.object({ id: z.string().length(24) }), body: body.partial() });

const router = Router();
const canManage = authorize(...CAN_MANAGE);
router.use(authenticate);

/**
 * The whole master, in the sheet's own order.
 *
 * Unpaginated on purpose: this is a couple of dozen rows that a buyer scans
 * like a spreadsheet, and the picker that reads it needs all of them to build
 * its dropdown. If it ever grows past a few hundred, paginate the page and
 * leave this route whole for the picker.
 */
router.get('/', asyncHandler(async (req, res) => {
  const vendors = await VendorMaster.find().sort({ sortOrder: 1, item: 1, vendorName: 1 });
  return ApiResponse.ok(res, vendors, 'Vendor master fetched');
}));

router.post('/', canManage, validate(createSchema), asyncHandler(async (req, res) => {
  const code = vendorCode(req.body.item, req.body.vendorName);
  if (await VendorMaster.findOne({ code })) {
    throw ApiError.badRequest(
      `"${req.body.vendorName}" is already listed for "${req.body.item}".`,
      { code: 'VENDOR_EXISTS' },
    );
  }
  /* New rows go to the end. `sortOrder` is seeded in tens so somebody can slot
     a row between two others later without renumbering the list. */
  const last = await VendorMaster.findOne().sort({ sortOrder: -1 }).select('sortOrder serial');
  const vendor = await VendorMaster.create({
    ...req.body,
    code,
    sortOrder: req.body.sortOrder ?? (last?.sortOrder ?? 0) + 10,
    serial: req.body.serial ?? (last?.serial ?? 0) + 1,
    createdBy: req.user.id,
    updatedBy: req.user.id,
  });
  return ApiResponse.created(res, vendor, 'Vendor added');
}));

router.patch('/:id', canManage, validate(updateSchema), asyncHandler(async (req, res) => {
  const vendor = await VendorMaster.findById(req.params.id);
  if (!vendor) throw ApiError.notFound('Vendor not found');

  /* `code` is left alone when the item or the name is corrected, the same call
     the game catalogue makes: it is the row's identity, and re-seeding from
     the sheet should refresh THIS row rather than add a second one beside it. */
  Object.assign(vendor, req.body, { updatedBy: req.user.id });
  await vendor.save();
  return ApiResponse.ok(res, vendor, 'Vendor updated');
}));

router.delete('/:id', canManage, validate(idParam), asyncHandler(async (req, res) => {
  const vendor = await VendorMaster.findByIdAndDelete(req.params.id);
  if (!vendor) throw ApiError.notFound('Vendor not found');
  return ApiResponse.ok(res, { _id: vendor._id }, `${vendor.vendorName} removed from the master`);
}));

export default router;
