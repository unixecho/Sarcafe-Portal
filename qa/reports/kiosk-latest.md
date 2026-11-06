# סקירת QA · הקיוסק · 7.11.2026, 1:01:38
**הכול ירוק. מוכן לשחרור.**
38 מתוך 38 בדיקות עברו ב־7 דקות ו־19 שניות. אבטחה 11/11 · שרידות 1/1 · מקצה לקצה 11/11 · נגישות וקריאות 1/1.
## מה טוב
- כל בדיקות הבדיקה סטטית עברו (3)
- כל בדיקות הלוגיקה עברו (1)
- כל בדיקות המסד נתונים עברו (2)
- כל בדיקות האבטחה עברו (11)
- כל בדיקות המקצה לקצה עברו (11)
- כל בדיקות הרגרסיה עברו (8)
- כל בדיקות השרידות עברו (1)
- כל בדיקות הנגישות וקריאות עברו (1)
- הטקסט קריא בכל המראות: הניגודיות הנמוכה ביותר 5.02:1 (הסף 4.5)

## מה השתנה

- תוקנה: אשף ההתקנה בדפדפן: ממלאים סניף, שם וקוד, מקבלים QR והוראות, רואים "הותקן" כשהטאבלט סרק; קריא בכל המראות; רק בעלים

## הצעדים הבאים
1. אין צורך בפעולה. הריצה הבאה מחר בבוקר, ואחרי כל פרסום

## שלבים
- ✅ הקיוסק: הקוד של הדף, החבילה והאפליקציה (Java): 5/5
- ✅ בדיקות הרגרסיה של הקיוסק (check:kiosk-* ו־verify:kiosk-*): 9/9
- ✅ הקיוסק: ה־API של הטאבלט ושליטה מרחוק מלוח הבקרה: 17/17
- ✅ הקיוסק: לוח הקיוסק בדפדפן אמיתי: 7/7

## צפוי מול בפועל
כל הבדיקות עברו.

<details><summary>בדיקות שעברו (38)</summary>

### ✅ כל הסקריפטים של דף הקיוסק תקינים (node --check)
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | only 18 scripts | כן | כן |
| ✅ | scripts that do not parse: | [] | [] |

### ✅ חבילת הדף נבנית: כל הקבצים, כל אחד במקום, בלי קובץ ריק
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | index.html | כן | כן |
| ✅ | 39 files | כן | כן |
| ✅ | empty files in the bundle: | [] | [] |
| ✅ | index.html loads kiosk-device.js | כן | כן |

### ✅ האפליקציה (Java): קוד שנקבע בלוח הבקרה נבדק אצל הטאבלט כמו קוד שהוקלד בו, ורשומה פגומה נדחית
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | the portal still makes records this way | כן | כן |
| ✅ | javac:  | כן | כן |
| ✅ | 0.*\|172.16.*\|172.17.*\|172.18.*\|172.19.*\|172.20.*\|172.21.*\|172.22.*\|172.23.*\|172.24.*\|172.25.*\|172.26.*\|172.27.*\|172.28.*\|172.29.*\|172.30.*\|172.31.*\|192.168.*\|1… | כן | כן |

### ✅ האפליקציה מושכת קוד מרחוק בכל בדיקת עדכונים, שומרת אותו כמו קוד שהוקלד ומאשרת; הדף מבצע פקודות פעם אחת
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | checked with every update check | כן | כן |
| ✅ | fetched with the kiosk key | כן | כן |
| ✅ | the record is checked before it is kept | כן | כן |
| ✅ | kept exactly where the PIN dialog reads it, lockout cleared | כן | כן |

### ✅ עורך התפריט — הפונקציה במסד הנתונים (Postgres אמיתי): שם ומחיר לפריט ולסוג, ניקוי מחיר, טיוטה בלבד כשסגור, שם ריק נדחה, נעולה לדפדפנים
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | ערך | מאפה רגיל | מאפה רגיל |
| ✅ | ערך | 14 | 14 |
| ✅ | ערך | 20/24 | 20/24 |
| ✅ | closed: draft only | כן | כן |

### ✅ check:kiosk-content
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | exit 0. 66 passed, 0 failed | כן | כן |

### ✅ check:kiosk-device
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | exit 0. ✓ a real read failure is an outage (it throws), not "no such tablet" \| 92 passed, 0 failed | כן | כן |

### ✅ check:kiosk-i18n
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | exit 0. check-kiosk-i18n: 233 passed, 0 failed | כן | כן |

### ✅ check:kiosk-menu
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | exit 0. 33 passed, 0 failed | כן | כן |

### ✅ check:kiosk-ota
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | exit 0. broken bundles are never published, and never fail the portal build \| ✓ signature fails for another version / seq \| ✓ java: wrong PIN fails \| ✓ j… | כן | כן |

### ✅ check:kiosk-session
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | exit 0. check-kiosk-session: 132 passed, 0 failed | כן | כן |

### ✅ check:kiosk-ui
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | exit 0. check-kiosk-ui: 231 passed, 0 failed | כן | כן |

### ✅ check:kiosk-waitlist
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | exit 0. 52 passed, 0 failed | כן | כן |

### ✅ verify:kiosk-content-sql
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | exit 0. 161 passed, 0 failed | כן | כן |

### ✅ הדיווח של הטאבלט: בלי מפתח או עם מפתח שגוי — 401; סוג תוכן שגוי, גוף גדול או לא תקין — נדחה; תקין — נרשם
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | no key | HTTP 401 | HTTP 401 |
| ✅ | wrong key | HTTP 401 | HTTP 401 |
| ✅ | not JSON | HTTP 415 | HTTP 415 |
| ✅ | too large | HTTP 413 | HTTP 413 |

### ✅ הטאבלט שומר רק את ההגדרות שלו, בתוך הגבולות; לא את הסניף, השם או המפתח
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | out of bounds | HTTP 400 | HTTP 400 |
| ✅ | the branch is the owner's | HTTP 400 | HTTP 400 |
| ✅ | an unknown section | HTTP 400 | HTTP 400 |
| ✅ | a good save | HTTP 200 | HTTP 200 |

### ✅ פקודה מלוח הבקרה: מגיעה לטאבלט עם הדיווח, נשארת עד שהוא מאשר אותה, ומתנקה רק עם המזהה שלה
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | the owner sends a reload | HTTP 200 | HTTP 200 |
| ✅ | stored on the tablet | כן | כן |
| ✅ | handed over with the report | cc4ed729-c2bd-42fe-90e9-31dc707a5da7 | cc4ed729-c2bd-42fe-90e9-31dc707a5da7 |
| ✅ | another id does not clear it | cc4ed729-c2bd-42fe-90e9-31dc707a5da7 | cc4ed729-c2bd-42fe-90e9-31dc707a5da7 |

### ✅ איפוס קוד מלוח הבקרה: נשמרת רק "טביעה", הטאבלט מושך אותה עם המפתח, מאשר, והיא נמחקת
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | no key | HTTP 401 | HTTP 401 |
| ✅ | תשובת השרת | HTTP 200 | HTTP 200 |
| ✅ | nothing waiting | null | null |
| ✅ | the owner sets a PIN | HTTP 200 | HTTP 200 |

### ✅ קוד חדש: 6–8 ספרות, לא רצף ולא ספרה חוזרת, שני הקודים זהים; בעלים בלבד, מאותו אתר; 5 בשעה
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | 12345: too short | HTTP 400 | HTTP 400 |
| ✅ | 123456789: too long | HTTP 400 | HTTP 400 |
| ✅ | 12a456: not digits | HTTP 400 | HTTP 400 |
| ✅ | 111111: one digit | HTTP 400 | HTTP 400 |

### ✅ הבעלים משנה כל הגדרה של הטאבלט מלוח הבקרה, בתוך הגבולות, וכלל צולב נאכף
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | two sections at once | HTTP 200 | HTTP 200 |
| ✅ | ערך | false | false |
| ✅ | ערך | 40 | 40 |
| ✅ | out of bounds | HTTP 400 | HTTP 400 |

### ✅ מלאי מהקיוסק: רק עם המפתח; מציג בדיוק את הקטגוריות של המלאי החי בלוח הבקרה (כריכים, מאפים, שייקים), עם כל הסוגים
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | no key | HTTP 401 | HTTP 401 |
| ✅ | wrong key | HTTP 401 | HTTP 401 |
| ✅ | bad tablet name | HTTP 400 | HTTP 400 |
| ✅ | unknown tablet | HTTP 404 | HTTP 404 |

### ✅ עדכון מלאי מהקיוסק: נכנס לטיוטה ולתפריט שמוצג ללקוחות מיד, כמות 0 = אזל, ונרשם ביומן "מהקיוסק"
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | count down | HTTP 200 | HTTP 200 |
| ✅ | draft | 2 | 2 |
| ✅ | published: customers see it at once | 2 | 2 |
| ✅ | the answer is the new list | 2 | 2 |

### ✅ מלאי מהקיוסק — כללי לוח הבקרה: רק בשעות הפעילות, רק פריטים של המלאי החי, רק עם המפתח, קלט לא תקין נדחה
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | no key | HTTP 401 | HTTP 401 |
| ✅ | coffee is not on the live list: the kiosk cannot touch it | HTTP 404 | HTTP 404 |
| ✅ | untouched | undefined | undefined |
| ✅ | unknown type | HTTP 404 | HTTP 404 |

### ✅ אשף ההתקנה: הבעלים יוצר QR, טאבלט שאופס מקבל פעם אחת את כל ההגדרות שלו (כתובת, ערוץ, מפתח, שם, קוד הצוות כטביעה)
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | QR made | HTTP 201 | HTTP 201 |
| ✅ | ערך | il.co.sarcafe.kiosk/.KioskAdminReceiver | il.co.sarcafe.kiosk/.KioskAdminReceiver |
| ✅ | downloads the published app | כן | כן |
| ✅ | Android checks the signing certificate | q6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6s | q6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6s |

### ✅ אשף ההתקנה — כללים: בעלים בלבד ומאותו אתר, קוד צוות חזק, קוד התקנה פג אחרי 24 שעות, קוד שגוי = 404, הצפה נחסמת, בלי אפליקציה חתומה אין QR
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | no QR before an app with its certificate digest is published | HTTP 409 | HTTP 409 |
| ✅ | gm cannot install | כן | כן |
| ✅ | dana cannot install | כן | כן |
| ✅ | signed out | כן | כן |

### ✅ עורך התפריט בקיוסק: רק עם המפתח; כל הקטגוריות, הפריטים והסוגים עם שם ומחיר
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | no key | HTTP 401 | HTTP 401 |
| ✅ | תשובת השרת | HTTP 200 | HTTP 200 |
| ✅ | ערך | no-store | no-store |
| ✅ | every category, not only the live ones | ["קפה חם","כריכים וטוסטים","מאפים","שייק פירות טבעי"] | ["קפה חם","כריכים וטוסטים","מאפים","שייק פירות טבעי"] |

### ✅ עורך התפריט בקיוסק: שינוי שם ומחיר, הוספה ומחיקה של פריט וסוג — בטיוטה ובתפריט שמוצג ללקוחות, ונרשם ביומן "מהקיוסק"
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | rename + reprice | HTTP 200 | HTTP 200 |
| ✅ | customers see the new name | הפוך קטן חם | הפוך קטן חם |
| ✅ | ערך | 13 | 13 |
| ✅ | a type's price | HTTP 200 | HTTP 200 |

### ✅ עורך התפריט — כללי לוח הבקרה: רק בשעות הפעילות, רק התפריט של הסניף של הטאבלט, קלט לא תקין נדחה, הצפה נחסמת
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | no key | HTTP 401 | HTTP 401 |
| ✅ | nothing to change | HTTP 400 | HTTP 400 |
| ✅ | empty name | HTTP 400 | HTTP 400 |
| ✅ | name too long | HTTP 400 | HTTP 400 |

### ✅ חיבור בקוד: אפליקציה בלי הגדרות מקבלת קוד, הבעלים מקליד אותו באשף, והאפליקציה מקבלת פעם אחת את כל ההגדרות
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | a pairing | HTTP 201 | HTTP 201 |
| ✅ | a short code to show, a long token to keep | כן | כן |
| ✅ | the token is stored only as a hash | כן | כן |
| ✅ | waiting for the owner | waiting | waiting |

### ✅ חיבור בקוד — כללים: הקוד אינו סיסמה (רק בעלים מחובר משתמש בו), פג אחרי 15 דקות, פעם אחת, אסימון שגוי לא מקבל כלום, הצפה נחסמת
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | gm cannot pair | כן | כן |
| ✅ | dana cannot pair | כן | כן |
| ✅ | an unknown code | HTTP 404 | HTTP 404 |
| ✅ | not a code | HTTP 400 | HTTP 400 |

### ✅ מסד הנתונים לא עונה: ה־API של הקיוסק עונה בשגיאה מסודרת בלי פרטים פנימיים, וחוזר לעבוד
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | /api/kiosk/device → 502 | כן | כן |
| ✅ | /api/kiosk/device leaks | לא מכיל /stack\|at \/\|node_modules\|PGRST\|relation \|select \|postgres/i | לא נמצא |
| ✅ | /api/kiosk/device/pin?device=givat-haviva-1 → 502 | כן | כן |
| ✅ | /api/kiosk/device/pin?device=givat-haviva-1 leaks | לא מכיל /stack\|at \/\|node_modules\|PGRST\|relation \|select \|postgres/i | לא נמצא |

### ✅ לוח הקיוסק: מצב הטאבלט (מחובר, סוללה, גרסאות), פעולות מרחוק וכל ההגדרות, עם הסרגל התחתון
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | the control panel | כן | כן |
| ✅ | the tablet by name | כן | כן |
| ✅ | online (reported 2 minutes ago) | כן | כן |
| ✅ | the battery ring says 41% | כן | כן |

### ✅ מעבר בין הלוחות בשני הכיוונים, בלי טעינה מחדש של הדף ועם אותו סרגל תחתון (בעלים ומפתח)
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | owner: no full page load | כן | כן |
| ✅ | dev: no full page load | כן | כן |

### ✅ שינוי הגדרה: פס השמירה מופיע, שמירה מעדכנת את הטאבלט, ביטול מחזיר
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | cancel removes the bar | 0 | 0 |
| ✅ | saved on the tablet's row | false | false |
| ✅ | the bar goes once saved | 0 | 0 |

### ✅ פקודה מרחוק ואיפוס קוד מהמסך: נשלחים, מוצגים כ"ממתין לטאבלט" וניתנים לביטול; קוד חלש נדחה במקום
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | stored for the tablet | reload | reload |
| ✅ | cancelled | null | null |
| ✅ | a guessable PIN is refused on the spot | כן | כן |
| ✅ | stored for the tablet | 1 | 1 |

### ✅ רק בעלים: עובד/ת ומנהל/ת סניף לא נכנסים ללוח הקיוסק
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | dana → 307 http://localhost:3399/no-access | כן | כן |
| ✅ | gm → 307 http://localhost:3399/no-access | כן | כן |
| ✅ | signed out goes to sign in | כן | כן |

### ✅ לוח הקיוסק קריא בכל חמשת המראות, באייפון ובטאבלט, בלי גלילה לצדדים
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | text below AA contrast: | [] | [] |
| ✅ | 390px: 0px sideways | כן | כן |
| ✅ | 390px: the top bar covers the first card | כן | כן |
| ✅ | 768px: 0px sideways | כן | כן |

### ✅ אשף ההתקנה בדפדפן: ממלאים סניף, שם וקוד, מקבלים QR והוראות, רואים "הותקן" כשהטאבלט סרק; קריא בכל המראות; רק בעלים
| | מה נבדק | צפוי | בפועל |
|---|---|---|---|
| ✅ | nothing to create before the PIN | כן | כן |
| ✅ | a guessable PIN is refused on the spot | כן | כן |
| ✅ | the steps for the tablet | כן | כן |
| ✅ | the USB fallback carries the same one-time code | כן | כן |
</details>
