/*
 * The business behind the kiosk: the facts the privacy notice and the terms state (who holds the data, and how to reach
 * them). To change one, edit the value below, run build.ps1, install the app, and change the three version ids in
 * kiosk-legal.js and src/lib/kiosk/waitlist.ts together (the notice text changed). A value left empty shows in the
 * notice as a highlighted [bracket] and the privacy screen warns.
 *
 *   ownerFirstName / ownerLastName   the person responsible for the database
 *   businessName                     the business, as the notice names it
 *   phone                            the number people call for privacy requests (access, correction, deletion, opt-out)
 *   email, address                   optional, shown when filled
 *
 * No company / VAT number is shown: the owner chose not to present one.
 */
window.SARCAFE_BUSINESS = {
  ownerFirstName: 'שרי',
  ownerLastName: 'איסרליס',
  businessName: 'שרקפה (Sarcafe)',
  phone: '0507437395',
  email: '',
  address: '',
};
