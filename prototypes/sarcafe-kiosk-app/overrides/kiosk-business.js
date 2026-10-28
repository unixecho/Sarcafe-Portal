/*
 * The business behind the kiosk: the facts the privacy notice and the terms must state (who holds the data, and how to
 * reach them). Fill the quoted values below, rebuild the app (build.ps1) and install it. Until a value is filled, the
 * notice shows it as a highlighted [bracket] and the sign-up screen warns, so a notice that does not say who is
 * responsible is never mistaken for a finished one.
 *
 *   ownerFirstName / ownerLastName   the person responsible for the database
 *   businessName                     the name of the business as registered (e.g. the legal name behind "Sarcafe")
 *   companyId                        the company / authorised-dealer number (ח.פ. / ע.מ.)
 *   phone                            the number people call for privacy requests (access, correction, deletion, opt-out)
 *   email, address                   optional, shown when filled
 */
window.SARCAFE_BUSINESS = {
  ownerFirstName: '',
  ownerLastName: '',
  businessName: '',
  companyId: '',
  phone: '',
  email: '',
  address: '',
};
