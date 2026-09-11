// Real branch data carried over from the legacy static site
// (legacy-static-site/script.js) — navigation/social/payment links are
// live business data, not placeholders, so they're migrated as-is rather
// than re-entered.

export const PAYBOX_PHONE_NUMBER = '0507437395'

export const PORTAL_BRANCHES = {
  maor: {
    navigation: {
      googleMaps:
        'https://www.google.com/search?q=%D7%A9%D7%A8%D7%A7%D7%A4%D7%94+%D7%9E%D7%90%D7%95%D7%A8',
      waze: 'https://waze.com/ul/hsvbbkw6z7',
      appleMaps: 'https://maps.apple/p/qpTdR-CW92-k85',
    },
    instagram: 'https://www.instagram.com/sarcafe_maor/',
    review:
      'https://www.google.com/search?q=%D7%A9%D7%A8%D7%A7%D7%A4%D7%94+%D7%9E%D7%90%D7%95%D7%A8+Reviews#lrd=0x151d11a50c80e89b:0x96d561f512db6ca9,3,,,,',
    bit: 'https://www.bitpay.co.il/app/me/E651C59A-1BFE-BEC5-4393-DC2A3AB120825472',
  },
  'givat-haviva': {
    navigation: {
      googleMaps:
        'https://www.google.com/search?q=%D7%A9%D7%A8%D7%A7%D7%A4%D7%94+%D7%92%D7%91%D7%A2%D7%AA+%D7%97%D7%91%D7%99%D7%91%D7%94+Reviews',
      waze: 'https://www.waze.com/live-map/directions?to=ll.32.458484%2C35.021689',
      appleMaps: 'https://maps.apple/p/eB5XbpUbv.RmXQ',
    },
    instagram: 'https://www.instagram.com/sarcafe_givat.haviva/',
    review:
      'https://www.google.com/search?q=%D7%A9%D7%A8%D7%A7%D7%A4%D7%94+%D7%92%D7%91%D7%A2%D7%AA+%D7%97%D7%91%D7%99%D7%91%D7%94+Reviews#lrd=0x151d0ff513e8629d:0xa96e0271dcb22bc9,3,,,,',
    bit: 'https://www.bitpay.co.il/app/me/E651C59A-1BFE-BEC5-4393-DC2A3AB120825472',
  },
} as const
