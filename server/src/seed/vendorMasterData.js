/**
 * The supply vendor master, transcribed from SHEET/F Vendor.xlsx ("Sheet1").
 *
 * This is the list a buyer picks from: what we buy, who we buy it from, and
 * the number to ring. It lives in the repo so a fresh database seeds the same
 * list — `seedVendorMaster.js` loads it, and Master Data → Vendors maintains it
 * from then on.
 *
 * FIDELITY TO THE SHEET, and where it is imperfect.
 *
 * The sheet has four columns — S.no, Item, Vendor, Contact Number — and 23
 * supplier rows under 22 numbers. All 23 are here.
 *
 *  - Row 4 of the sheet carries no S.no and no Vendor: it puts "Jawahar Arora
 *    Sharp Technology BNI" in the ITEM column with a phone number beside it.
 *    Read in place it is plainly a SECOND supplier for line 2's "Refurbished",
 *    not an item we buy, so it is recorded that way and keeps `serial: 2`. The
 *    alternative — an item called "Jawahar Arora Sharp Technology BNI" with no
 *    vendor at all — would be a faithful transcription of a typo and useless
 *    to the person reading the list.
 *
 *  - Spelling is the sheet's own: "Electronis Auto aprts", "Cordinate cad
 *    Design", "Arylic Sheet work", "Uniform Jailor", the double space in
 *    "Fine  Arts". A master that silently disagrees with the source document
 *    is worse than one with a visible typo. Correct it on the Vendors page and
 *    the correction sticks — re-seeding matches on `code`, which is derived
 *    from the ORIGINAL item and vendor, so a corrected row is refreshed rather
 *    than duplicated.
 *
 *  - Trailing spaces in the sheet's cells ("Balloon ", "Tv ", "ROBOTICS ") are
 *    trimmed. That is whitespace, not spelling, and an untrimmed name breaks
 *    the exact-name match the purchase-order page does on the vendor.
 *
 * `sortOrder` is the sheet's row order in tens, so the page reads top to bottom
 * exactly as the spreadsheet does and a new row can still be slotted between
 * two old ones.
 */

/** The sheet's rows, in the sheet's order. `code` is added by the seeder. */
export const VENDOR_MASTER = [
  { serial: 1, item: 'New Computer Accessories', vendorName: 'Shri Chand Computer Pvt Ltd', contactNumber: '9599846725' },
  { serial: 2, item: 'Refurbished', vendorName: 'Vardhman Computer (Amit)', contactNumber: '9811020416' },
  // The sheet's unnumbered continuation row — see the note above.
  { serial: 2, item: 'Refurbished', vendorName: 'Jawahar Arora Sharp Technology BNI', contactNumber: '9811460485' },
  { serial: 3, item: 'Balloon', vendorName: 'Utsav Trading Balloon', contactNumber: '9654054385' },
  { serial: 4, item: 'Tv', vendorName: 'Keytech', contactNumber: '9220232027' },
  { serial: 5, item: 'T - Shirt Printing', vendorName: 'UNST', contactNumber: '8076176093' },
  { serial: 6, item: 'Modules', vendorName: 'Engenius Lab', contactNumber: '7982130249' },
  { serial: 7, item: 'Electronis Auto aprts', vendorName: 'ROBOTICS', contactNumber: '9599594520' },
  { serial: 8, item: 'Medals', vendorName: 'Creative Plastics', contactNumber: '9810082153' },
  { serial: 9, item: 'Push Buttons', vendorName: 'Bobby Video Game', contactNumber: '9555412346' },
  { serial: 10, item: 'Fiber Props', vendorName: 'Vaiga Creative', contactNumber: '7428662624' },
  { serial: 11, item: 'Camera', vendorName: 'Shri Chand Security & Solution', contactNumber: '9716935724' },
  { serial: 12, item: '3D Printing Prop', vendorName: 'Cordinate cad Design', contactNumber: '8860472536' },
  { serial: 13, item: 'Live ActorUniform Tailor', vendorName: 'Kashish Dressess', contactNumber: '9818111053' },
  { serial: 14, item: 'Cold Drink and water', vendorName: 'Krishna Chhabra', contactNumber: '9899949462' },
  { serial: 15, item: 'locks', vendorName: 'Swadeshi Vastu Bhandar', contactNumber: '9540540800' },
  { serial: 16, item: 'Modules and Sensor', vendorName: 'Engenius Lab', contactNumber: '7982130249' },
  { serial: 17, item: 'Speaker', vendorName: 'Ahuja Speaker', contactNumber: '9810030088' },
  { serial: 18, item: 'Uniform Jailor', vendorName: 'Anil Wardi', contactNumber: '9990081086' },
  { serial: 19, item: 'Digital Printing', vendorName: '2Ghetherz', contactNumber: '9220278995' },
  { serial: 20, item: 'Tonner and Cartridge', vendorName: 'Nareshkhurana36Printer', contactNumber: '9212617157' },
  { serial: 21, item: 'Arylic Sheet work', vendorName: 'Fine  Arts', contactNumber: '9711829948' },
  { serial: 22, item: 'water (Mystery Room Brand)', vendorName: 'Azoic Water (Aman Chawla)', contactNumber: '9810558340' },
];

export default VENDOR_MASTER;
