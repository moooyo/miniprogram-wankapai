# Activity Design Handoff Implementation Brief

## Audit scope and source authority

- Source package: `D:/Code/design_handoff_activity_features`.
- Read the complete handoff README, overview, full prototype template and ViewModel, screenshot mock, device frame, and asset inventory. The package contains a design reference, not production source.
- `README.md` defines the four new activity capabilities and the final visual tokens. `WankapaiBlueV2.dc.html` defines the full product layout and interaction states. Its template is native-portable reference material: interpolation becomes WXML bindings and computed ViewModels become typed presentation functions.
- Preserve the existing native WXML/WXSS/TypeScript and application/domain service architecture. Rebuild source through `scripts/build.mjs`; never port the prototype runtime or maintain a hand-edited distribution.
- Public submissions and operator moderation remain in scope. Platform category approval is a release prerequisite, not a reason to remove these capabilities.
- All product copy must be Chinese. This brief intentionally describes copy in English; copy exact Chinese strings from the corresponding handoff template and README, with the consistency exceptions documented below.

## Coordinate system and native shell

The reference viewport is **402 by 874 logical pixels**. Its iPhone bezel, dynamic island, status icons, home indicator, and simulated WeChat capsule are external frame/reference UI. Native implementation must use actual WeChat status/capsule metrics and safe-area insets instead of drawing duplicate platform chrome.

The README also says one pixel becomes two rpx on a 750 design canvas. This conflicts with a 402-pixel-wide canvas: at 402 logical pixels, exact proportional conversion is `designPx * 750 / 402`, or **1.865671642 rpx per design pixel**. Converting every dimension to twice the design value enlarges the layout by 7.2%. Use one deliberate coordinate system, document it, and compare at an identical 402-wide device viewport. Fixed design sizes may be represented in logical px while width/padding adapt to the native viewport.

| Shell part | Exact reference geometry |
| --- | --- |
| Root | 402 x 874; `#F3F6FB`; full-height; clipped viewport |
| Primary header | 98 high including 54 top padding; left 16; right reserve 110; title 20/600 |
| Secondary header | 98 high including 54 top padding; 44-high content; back hit area 44 x 44 with left margin 4; centered title 17/600 within left/right 100 |
| Native capsule reference | Top 60; right 8; 87 x 32; radius 16; external WeChat chrome |
| Bottom tabs | 84 total; 34 bottom safe area; white; top border 0.5 `#E3E9F2`; four equal-width tabs |
| Tab content | 24 x 24 linear icon; 3 gap; label 10/500; selected `#1F61D8`; inactive `#5E6E84` |
| Tab badge | 16 high; min width 16; radius 8; blue/white; DM Mono 10 |
| Scroll content | Horizontal padding 16; top 0, 2, or 4 per view; bottom generally 24, 28, 32, or 40 |
| Fixed action footer | White; top border 1; padding 12 16 34; gap 10; primary 50 high/radius 14 |
| Secondary page entrance | TranslateX from 100% to 0%; 0.34s `cubic-bezier(.2,.8,.2,1)` |
| Secondary page shadow | `-10px 0 30px -20px rgba(15,35,70,.4)` |

Native interaction hit areas should be at least 44 logical pixels even where the drawn pill/button is 30, 34, 36, or 40 high. Enlarge the transparent hit area without changing visual geometry.

## Global visual tokens

| Token | Value | Application |
| --- | --- | --- |
| Ink | `#0F1B2D` | Primary text; dark registration action |
| Ink secondary | `#3F4D63` | Secondary text and conditions |
| Ink tertiary | `#5E6E84` | Help and metadata |
| Placeholder | `#9AA8BC` | Empty values, past days, disabled text |
| Line | `#E3E9F2` | Card/input/border |
| Sunk | `#EBF0F7` | Segment background, neutral state |
| Page | `#F3F6FB` | Full page and shallow panels |
| Paper | `#FFFFFF` | Cards, selected segments |
| Soft button | `#EEF3FA` | Secondary actions |
| Primary | `#1F61D8` | Buttons and selection |
| Primary strong | `#2B6DE8` | Progress and OCR region outlines |
| Primary text | `#1A56C4` | Links, blue text |
| Primary background | `#E6EEFC` | Soft selected/participating states |
| OCR field | `#EEF4FE` / `#9DBBF2` | Background/border of OCR-filled inputs |
| Success | `#2D7A4F` / `#E2F0E4` | Eligible, recognized, receipt states |
| Warning | `#9A5B07` / `#FDF1DE` | Missing information, invitation restrictions |
| Urgent | `#C2410C` | Deadline and urgent bill text |
| Danger | `#B8392C` / `#F1C7C1` / `#FBE4E1` | Exit/error text, border, pressed background |
| Disabled | `#C5D0DF` | Disabled actions and dashed edges |
| Viewer | `#0B1220` | Fullscreen screenshot background |
| Viewer metadata | `#C9D3E1` | Viewer supporting text |
| Modal mask | `rgba(15,27,45,.42)` | Bottom sheet backdrop |

Typography: `'PingFang SC','Noto Sans SC','Hiragino Sans GB','Microsoft YaHei',system-ui,sans-serif`; dates, counts, monetary values, currency codes, and card networks use **DM Mono 400/500** with the Chinese sans fallback. The package loads DM Mono through Google Fonts; it includes no local font file. A native font strategy must be explicit and must not silently depend on Google Fonts being reachable.

Sizes: detail title 22/600; sheet title 20/600; secondary nav/date wheel 17/600; card title 16/600; section title 15/600; body 14; secondary 13; help 12; chips 11 and 10. Detail reward 30/500; activity-list reward 22/500; earnings hero 36/500. Body line heights are 1.45, 1.5, 1.55, or 1.6; activity title 1.35; major title 1.3.

Radii: capsule 999; sheet top 24; large hero 24/22/20; card 18; sheet action 16; button/panel 14; input/thumbnail 12; stepper 10; segment 9; timeline 8. Spacing vocabulary is 4, 6, 8, 10, 12, 14, 16, 18, 20, 24. Standard white card is 1px line border. Segment selected shadow: `0 1px 3px rgba(15,35,70,.14)`.

## Complete page and state inventory

The prototype has **four primary tabs, eleven secondary views, seven bottom-sheet kinds, and three additional overlays**. This is broader than the overview's activity feature gallery.

| View | States and key content | Template lines |
| --- | --- | --- |
| Progress tab | Next-action hero carousel; urgent deadline; count meter or cumulative amount bar; upcoming tasks including activity and bill rows; earnings summary; all-today-complete empty state | 18-64 |
| Activities tab | Bank rail; all/my-card toggle; subscription action; submit shortcut; cards with thumbnails; participating/eligible/ineligible/exited/completed/invited/new states; empty state | 121-157 |
| Cards and benefits tab | Two segments: personal cards and benefits lookup; overlapped bank-colored card stack; six benefit categories; benefit inventory; airport-lounge shortcut | 65-120 |
| Mine tab | Identity and role; participation history; submissions; reminders; benefits and lounges shortcuts; submit; privacy; moderator-only review; explicit demo role control | 158-184 |
| Reminder settings | Four switches; saved/dirty state; expandable authorization help; fixed save footer | 192-206 |
| My submissions | Pending, returned, published cards; returned feedback; new submission; empty state | 208-221 |
| Operator review | Pending/returned/published tabs and counts; source preview; screenshot gallery; duplicate warning; rule completion; publish/return; empty states | 223-272 |
| Submission form | New, pending editable, returned resubmission, saved draft; empty screenshots; populated; busy OCR; successful/partial/zero-result OCR; OCR/manual conflict; optional rules collapsed/expanded; submit success | 274-361 |
| Participation history | All/unfinished/pending-confirmation segments; period/state/cards/progress or reward cards; optional explanation; operation record link; empty states | 363-384 |
| Add/edit card | New bank grid; immutable issuer when editing; credit/debit; network; nickname; payment plan on/off; statement/due-date/reminder controls; two-step removal | 386-417 |
| Register benefit | Seven categories including other; card; lounge channel; counted/text branches; total/used/remaining; expiration; transferability; validation | 419-457 |
| Lounge lookup | Landing with recent airports/channels/catalogue; airport/code/city search; search suggestions/no-match; airport results; terminal filter; enterable-only toggle; available/unavailable lounges; supported product expansion; empty filter | 459-527 |
| Card detail | Bank-colored card hero; edit/register-benefit actions; bill or no-plan/debit information; repayment action; held benefits; joined activities; empty rows | 529-574 |
| Earnings | Current receipt-month and year totals; currencies separate; pending rewards and confirmation actions; current-month receipt records; all-history shortcut | 576-613 |
| Activity detail | Unjoined eligible/ineligible/invited/exited; joined registration/progress/waiting/received; count/amount progress; once/week/month/custom cycles; screenshots/no-screenshots; logs/no-logs; rules/entry; exit; stage-specific footer | 615-703 |
| Record consumption sheet | Amount/count input; suggested values; minimum threshold warning; resulting progress preview; save or save-and-qualify | 709-719 |
| Confirm receipt sheet | Actual amount or noncash reward; receipt date; confirmation | 720-728 |
| Join/select card sheet | Bank/title/reward; rules/cycle/entry; matching cards; selected radio state; registration prerequisite; join; no-card branch | 729-745 |
| Exit sheet | Context identity; dynamic impact list; cancel/confirm | 746-752 |
| Date picker sheet | Start/end; year/month/day; cancel/confirm; invalid ordering; day clamping | 753-766 |
| Return submission sheet | Four reason choices; optional explanation; disabled/active return | 767-772 |
| Operation history sheet | Chronological actions; descriptions and dates; empty state | 773-781 |
| Qualification success modal | Result of reaching target; immediate saving or expected receipt; dismiss | 783-791 |
| Screenshot viewer | Item/form/review contexts; image paging; OCR outlines; metadata; context-specific buttons | 793-807 |
| Toast | Dark centered label; 2-second duration; 0.2-second transition | 809 |

## Primary tab details

### Progress

- Main content uses gap 18; date at 13 tertiary; headline 24/600. Do not hardcode the reference date or deadline counts.
- Next-action card: white, border, radius 24, padding `16 18 18`, gap 14; shadow `0 18px 40px -26px rgba(31,97,216,.28)`. Top chip 12/600, padding 4 10; count DM Mono 12; carousel arrows drawn in 40 circles.
- Bank row logo 24, gap 8; title 22/600/1.3; reward supporting line 13. Count segments gap 6, height 12, radius 6; amount bar height 12. Progress row 15; deadline row 13 with 15 clock. Primary footer inside hero 50 high; detail action 88 wide.
- Upcoming rows in one radius-18 white group: min-height 64; padding `10 14 10 6`; gap 10; date column 50; logo 30; text 14/500 plus 12 metadata; reward DM Mono 13/500. Completed rows at opacity 0.6.
- Earnings strip blue, radius 18, padding 16, gap 12; main monthly amount 22/500; other currencies and pending 12/14.
- Complete empty card: dashed 1px disabled border; radius 24; padding 28 18; 92-round illustration placeholder; title 17/600; description 13.

### Cards and benefits

- Segment wrapper sunk, radius 13, padding 3; two equal 40-high radius-10 items; text 14/500 with 12 count.
- Card collection is a **stack**, not white list rows: every card is height 220, radius 18, padding `14 16`; every subsequent card has **margin-top -158**, leaving approximately 62 pixels of its header visible. Background is issuer color plus `linear-gradient(135deg,rgba(255,255,255,.14),rgba(255,255,255,0) 50%)`; shadow `0 -8px 18px -10px rgba(15,30,60,.4)`; pressed translateY -6. Header 34 high; logo 30; nickname 15/600; issuer 11; card type 13; due amount 20/500; network 14/500 with letter-spacing 1.
- Cards sorted by due date; urgent chip white with urgent orange text. Debit cards and cards without repayment plans have separate messaging. Add-card capsule 36 high.
- Benefit categories are a three-column grid, gap 8; tiles min-height 78, padding `11 12`, radius 14. Selected blue with white text; unselected white/line. Categories are lounge, delay insurance, transfer, health, carwash, points.
- Lounge shortcut blue, radius 18, padding `14 12 14 14`; 40 icon tile; title 15/600, help 12.
- Inventory list radius 18; rows padding `12 14`, gap 12; logo 34; card 14/500; bank 12 mono; metadata 12/1.4; optional transfer chip 10; remaining 16 mono; expiration 11; meter segments 16 x 5, gap 3.

### Mine

- Identity avatar placeholder 56 circle; nickname 18/600; login/role 12. Group rows min-height 64, padding `10 12 10 16`; labels 15/500 and help 12.
- Benefits and lounge shortcuts: two-column grid, gap 10, radius 16, padding 14; icon 36 in radius 10; icon graphic 20; title 15/600.
- Demo role control is 196 wide, sunk, radius 12/padding 3; two 34-high radius-9 segments. Show only as explicit demo behavior; never derive production authority from it.
- User-private cards, participation, earnings, and benefits never become public when a submission is published.

## Activity list fidelity

- Bank rail gap 8 and horizontal scrolling, sides 16. Each rail tile width 58; padding 8 0 7; radius 14; logo 30; label 12; selected background primary-bg, border primary, text primary-text, weight 600. All-bank logo is a blue 30 circle with white short marker.
- Matching row: count 12 tertiary; toggle label 13; switch 44 x 26, radius 13; white knob 22 at offset 2, translated 18 when active; disabled switch background `#C5D0DF`.
- List card white/line, radius 18, padding 14, gap 9; cards gap 12. Header logo 22, padding 2, sunk border; bank text 13 secondary; new chip 11/600, padding 2 7, blue/white.
- Cycle chip: height 22, horizontal 8, radius capsule, 11/600. Repeating uses primary-bg/primary-text and an 11 repeat icon; once uses sunk/secondary without repeat icon.
- Body two columns gap 12; text column gap 7; title 16/600/1.35; condition 13/1.55; facts 12 tertiary. Thumbnail 60 x 80, radius 9, border 1; count badge bottom/right 3, height 18, horizontal 6, radius 9, dark alpha .72, 10/500 white.
- Invitation warning 12/500, padding 3 8, radius 6, warning colors.
- Bottom area: top padding 10, dashed border 1, row gap 10; reward 22/500 primary-text, letter spacing -.3; reward type 12 secondary; status 12. Action 40 high, horizontal 16, radius 12, 14/600.
- Active participation status is blue and opens progress; exited is tertiary with blue rejoin; eligible is green with join; ineligible is neutral with an inactive-looking action and explicit explanation.
- Clicking thumbnail or action must stop propagation. Rest of card enters detail without requiring joining. Empty state has an explicit reset-to-all action.

## Submission, OCR, reward, and cycle editor

Section order is introduction, contextual pending/returned notice, screenshot card, basic activity information, optional rule card, other sources, privacy explanation, fixed save-draft/submit footer.

- Introduction 13/1.55 tertiary. Section cards radius 18 and padding 16; outer gap 14; basic and sources inner gap 16.
- Screenshot card title 15/600, help 12. Three columns, gap 8; tiles 3:4, radius 12, border 1. Delete graphic in 28 circle at top/right 4. Recognized badge bottom/left 5, height 20, horizontal 7, radius 10, green/white, 10/600. Add tile dashed 1.5 disabled border, blue text 12/500, plus 22.
- Six images maximum. Adding an image uses actual native selection/storage in production. The `POOL`/`SHOTDEF` mock chooser is only a demonstrator.
- OCR button min-height 58, radius 14, padding `10 14`, gap 12; scan icon 22; primary line 15/600, support 12; blue/white. Partial batches identify only new image count.
- Busy OCR: primary-bg with primary-text; spinner 22 and 2.5px border `#C7D8FA`, top primary, rotates 0.8s linear. Unprocessed image overlays blue alpha .08 with a scan band height 38%, gradient ending alpha .95, 1.1s ease-in-out alternate.
- Success OCR: success-bg, padding `12 14`, radius 14, gap 8; 16 check; title 14/600; undo 13/500; field pills white/green, 12/500, padding 3 9. Help and missing fields 12/1.5. Reward pair and activity-date pair each count as one recognized field group.
- OCR bank result collapses the bank grid into a 50-high recognized row, radius 12, border 1.5, 26 logo, name 15/500, change action 42-high transparent target. Bank selection grid four columns, gap 8, 26 logo, padding 8 0, radius 12, label 12.
- Text inputs height 48, horizontal padding 14, radius 12, border 1.5, text 15. Normal background page; recognized background/border use OCR colors. Recognized label chip 10/600, padding 2 6, radius 6, primary-bg/primary-text. Name conflict suggestion blue strip, radius 10, padding `8 6 8 12`, 12/1.45 with adopt action.
- Optional rules header min-height 62; title 15/600; subtitle 12; arrow 18 rotates 0.2s. Expanded content top border sunk, padding `14 0 16`, gap 16.
- Reward type pills: 34 high, horizontal 12, radius capsule, 13, gap 6; selected primary/white, else paper/line. Amount row height 48, gap 10; label 14 tertiary; numeric input right aligned DM Mono 17/500; unit 14 secondary. Gift uses reference-value label; points unit is points, otherwise bank-region currency.
- Cycle segmented control: four equal items, sunk radius 12/padding 3; item height 36/radius 9; text 14/500; selected paper/ink and segment shadow. Subpanel page/radius 14/padding 12/gap 12. Weekly days seven columns, gap 4, height 36/radius 10. Month/custom stepper buttons 36/radius 10/white/line, icon 14; counter DM Mono. Month day range 1-28; custom interval minimum 1, maximum 90 days/12 weeks/12 months. Unit chips 34 high, min-width 48. Preview 12 primary-text/1.5.
- Activity dates: two boxes separated by short connector, gap 8; each height 54, padding `0 10 0 12`, radius 12/border 1.5; label 11; value DM Mono 14/500; calendar icon 16. Conditions and source notes use three-row textareas, padding `12 14`, font 15/1.5.
- Other sources accept a link and an origin description/App entry path. Bank, title, and at least one link/path/image are mandatory. Reward value without type is invalid and expands rules. Actual date picker rejects an end date before start; moving start after end clears end.
- Live numeric filtering: digits and one decimal point, two decimal places maximum, remove leading zeros, maximum nine characters; points integer only, and switching to points drops fractional part. Use native `digit`/`number` input type.
- OCR recognizes only unrecognized screenshots. Empty or previously OCR-filled fields may be overwritten. A manually edited nonempty field is preserved; conflicting extracted value becomes a suggestion. Only the title suggestion is displayed in this design. Editing a group clears that group's provenance marker and error. Extracted rule groups automatically expand rules. Undo returns to the first pre-OCR form snapshot and retains screenshots.
- Draft persistence must be real within the selected runtime, not a success toast alone. Preserve existing guarded draft recovery behavior.
- Submission success is a separate view: padding `48 28`, 104-circle illustration placeholder, title 20/600, explanation 14/1.6, primary view-submissions and secondary continue buttons 50 high/radius 14.

## Screenshot viewer

- Fullscreen dark `#0B1220`, fade 0.22s. Header matches native secondary nav metric; close graphic 20 in 44 target; centered page `1 / N`, DM Mono 15, white.
- Image container occupies flexible middle; horizontal padding 44; width 100%, max-width 300; aspect 3:4; radius 14; shadow `0 24px 60px -24px rgba(0,0,0,.7)`. Real uploaded images replace mock drawings and retain suitable aspect-fit behavior. OCR boxes must be projected from returned image coordinates into the rendered image bounds.
- Multi-image arrows are 36 circles at left/right 4, centered vertically, background white alpha .14; icon 16; boundary opacity .3 and no wrap. Dots 6, gap 6, selected white vs alpha .3.
- Footer padding `16 20 40`, gap 10. Tag 12/600, padding 3 9, radius capsule, white alpha .16. Upload metadata 13 `#C9D3E1`; explanation 13/1.55. Actions 44 high/radius 12/white alpha .12 with 14/500 white text; pressed white alpha .2.
- Activity/list context: save picture and report issue; disclaimer that users uploaded it and bank rules prevail.
- Form context: delete only; recognized/unrecognized/no-information messages differ. Recognized areas use primary-2 outlines plus white text on blue tags for name/reward, time, rules/cycle, entry.
- Moderator context: copy screenshot link, with instruction to inspect title/time/rules before publication.
- Save, copy, delete, and report are actual operations in production. Prototype methods that only show successful toasts are not sufficient implementations.

## Activity detail and exit

- Outer padding `4 16 24`, card gap 14. Header info card radius 20, padding 18, gap 12; logo 24; bank/context 13; title 22/600/1.3; reward 30/500/primary, letter-spacing -.5; type 13.
- Unjoined eligibility follows dashed divider with top padding 14; eligibility panel radius 12/padding 11 12/gap 10, 20 colored round status icon; title 14/600; explanation 12/1.5. Eligible green, ineligible neutral; exited explicitly explains progress restoration.
- Joined progress follows dashed divider with gap 9; description 14/500; count 15 mono; segments or bar 10 high/radius 5; deadline 13 with 15 clock.
- Joined step row white/line/radius 20, padding `16 8 12`; four steps for registration/qualification/waiting/receipt or three for instant discounts. Node 24 circle with 2 border; connector 2 high; label 12; helper 10 with 12 minimum height.
- Before joining, screenshots follow the hero and precede cycle. After joining, steps and cycle precede personal logs and then screenshots. Gallery width 108, image 108 x 144, radius 12/border 1, gap 10; tag 12/500, uploader 11. Gallery uses negative side margins to reach page width but retains 16 scroll insets. No-image state has dashed border/radius 18 and upload action.
- Cycle card padding `14 16 16`, radius 18, gap 12. Title 15/600 and type 12/600; explanation 13/1.55.
- Month/custom timeline: previous and next each 56 wide; gaps 6; middle flex; height 32/radius 8; previous sunk; current primary-bg with elapsed fill `#C9DAFB`; next dashed 1.5 disabled; current indicator 2 primary; captions 12; tick labels DM Mono 11; today label 10/600, with 15 label band and clamped placement 12%-88%.
- Weekly timeline: seven equal columns gap 4; cells padding `7 0 6`, radius 10, border 1.5; weekday 11; day DM Mono 15/500; marker 10/600 with 13 min-height. Today primary border, future usable day primary-bg; past day page and placeholder text.
- Once timeline: one 32-high sunk bar with elapsed `#D5DEEA`, 2 primary indicator, 12 status, start/end tick text 11. No previous/next periods.
- Cycle footer shallow page panel radius 12, padding `10 12`, gap 8; icon 15, text 13/1.5. Text changes for future/current/end day/expired/qualified.
- Personal logs grouped white/line/radius 18; row padding `12 14`; date 40-wide/DM Mono12; note 14; amount DM Mono14/500. Empty consumption row padding18/13 tertiary.
- Rules/entry group radius18, horizontal16; each row vertical12, body14/1.6; label width36 tertiary; dividers sunk. Entry has a copy action. Final official-rule/check-date/report text 12/1.6.
- Exit only for joined state, at bottom of scroll content: min-height56, radius14, danger border1, title15/500/danger, subtitle12 tertiary, pressed danger-soft.
- Fixed bottom actions: copy-entry 112 x 50, soft-button; main flex/50/radius14/16/600. Eligible join/rejoin primary. Unregistered action dark ink; progress action blue; receipt confirmation green. Completed/unavailable display a single inert status bar.
- Exit confirmation: shared bottom sheet; title20/600; identity13/1.5; impact list page/radius14/padding2 14; row vertical10, gap10, body14/1.5, dividerline, 6-round marker at top8. Two equal 52-high/radius16 actions, secondary cancel and danger confirm.
- Dynamic exit impacts: remove from progress/deadline/receipt reminders; retain current records, or stop reward confirmation if already qualified; stop following future recurrence, or explain single-period recovery; if registered, clarify bank-side registration remains.
- Exit removes from home/progress/card detail/pending statistics, retains all-period history with exited state, suppresses reminders and future auto-follow. Rejoin restores same preserved progress rather than creating a duplicate participation. Rejoin must continue ownership, transaction, and idempotency guarantees.

## Date picker and other shared sheets

Shared sheet: white; top radii24; padding `10 20 40`; gap16; drag handle36 x5/radius3/line; shadow `0 -10px 30px -12px rgba(15,35,70,.3)`; backdrop alpha .42/fade .25s; entrance translateY110% to0% over .32s with standard easing.

- Date header: cancel/confirm targets min-width60/high44; 16 text, confirm600/primary-text; title17/600. Three columns, gap4, visible220, five rows44; selected band top88/high44/radius12/page; upper/lower88 fade masks. Selected text17/600/ink; other placeholder. Readout13/tertiary. Year2025-2028; valid days depend on month/year; clamp excessive day to month end. Native `picker-view` can reproduce this. Native `picker mode=date` is accepted by README but visually differs, so account for this explicitly in fidelity evidence.
- Consumption amount panel60 high/radius16/soft background/padding0 16; currency22 mono; amount28/500 mono; suggested amount pills36 high; preview14/500 in primary-bg/radius14/padding12 14; action52/radius16/17/600. Count-mode amounts remain optional but must satisfy minimum when provided; amount-mode must be positive.
- Receipt panel uses same monetary geometry; noncash reward panelpadding16/radius16; actual receipt date must be editable/dynamic and determine income month. Reference date is a static prototype value only.
- Join card options min-height56/padding8 14/radius14/border1.5; selected primary-bg/border; logo30; nickname15/500; card type/network12 mono; radio20 with inner10. Join action52/radius16/17/600; registration prerequisite warning13.
- Return reason pills min-height40/padding0 14/radiuscapsule/border1.5/font14; explanation input48; action52/radius16. Reasons represent unreadable activity dates, missing entry, ended activity, duplicate.
- Operation list max-height420/page/radius14/padding0 14; rowsvertical11; label14/500; description12; date12 mono. Audit records must derive from persisted operation history rather than be synthesized from current progress alone.
- Qualification modal: mask alpha .45; horizontal36; cardradius26/padding26 22 20/gap10; illustration104; title22/600; activity13; result14/1.6; close48/radius14/16/600; opacity .25s and scale .9 to1 over .3s `cubic-bezier(.2,1.4,.4,1)`.
- Toast bottom112; maximum width300; padding10 16/radius12/ink background/white14/1.4; translateY10 to0 plus opacity .2; duration2000ms.

## Review, history, cards, benefits, and lounge behavior

- Moderation tabs are pending/returned/published, counts included, segmented38 high/radius10. Source link/path/screenshots remain reviewable; duplicate detection warning must not automatically discard legitimate next-period submissions. Reward and cycle editor reuse the submission controls with tighter spacing. Pre-extracted fields are brought into review and clearly marked for confirmation. Publish requires reward >0 and selected cycle in the design, plus every existing backend publication invariant. Submission version must prevent stale overwrites. New approved activity becomes discoverable and may match owned cards. Returned reasons remain editable by submitter and can be resubmitted.
- Submission card states are blue pending, amber returned, green published; primary text16/600; issuer13; source12; date12; status11/600; return notice radius12/padding10 12/13/1.5.
- Reminder switches correspond to matched new activities, approaching activity deadlines, expected rewards, and credit-card repayments. Changes have explicit dirty state and only apply after save. Each real WeChat message still requires its scoped grant. Demonstration mode sends no messages. Real account/config authorization remains required.
- History tabs are all, unfinished, waiting for confirmation, 38 high. Cards show period12/600, status11/600, logo22, title15/500/1.4, card12, amount15 mono, footer12 and operation link13. Exited/skipped/missed remain in all history, not unfinished/pending filters. Benefits use actual usage date; receipts use actual receipt date.
- Card detail bank hero height210/radius20/padding18, gradient white alpha .16, shadow `0 18px 30px -20px rgba(15,35,70,.7)`. Logo34; issuer15/600; nickname24/600; network14 mono; card type13; account12. Edit/register buttons44/radius12. Bill stats three columns; label12, values15. Debit/no-plan branches stay explicit.
- Add/edit card requires bank; repeated bank/type needs nickname; duplicate nickname rejected. Issuer locked on edit. Credit/debit and network choices retained. Statement day1-31, current due offset0-60 in prototype, reminder0/1/3/5 days. Production must preserve independent/shared billing-account support and actual bill overrides already accepted by the repository. Removal is two-step and retains participation/receipts.
- Benefit registration includes lounge/delay/transfer/health/carwash/points/other. Counted types have total1-99 and used0-total; display remaining after save; expiration presets in prototype are references, not an excuse to remove flexible existing date support. Text benefits require content. Lounge channels dragon/pp/plaza/unionpay are metadata. Transfer states permitted/unverified/prohibited stay distinct; allowing guests does not imply transferability. Expiration never replenishes uses automatically. Persist use/reversal history.
- Lounge landing search50 high/radius14/border1.5; searchicon20; input16. Airport rows min62 with code48 x30/radius8/mono13; airporttitle15/500; metadata12; status12/600. Result hero radius20/padding16; code28 mono/primary; title17/600; availability14/500. Filter chips34/high/padding0 13. Loungecardsradius18/padding14; terminaltag11/600; status12/600; title17/600; metadata13/1.45; icon14; channels12. Available owned-card blocksuccess-bg/radius14; use-once action draw30 high with44 hit area. Supported-card disclosure min46; rowsmin36/logo22/text14; ownedchip11. Do not let the mock channel match replace existing bank/product/region/customer/booking constraints.

## Data model and period calculations

Map the new design contract onto existing validated API/domain entities rather than replacing strong domain state with the prototype's mutable arrays.

```ts
type RewardType = 'cash' | 'cut' | 'voucher' | 'points' | 'gift';
interface Reward { type: RewardType; value: number }
type Cycle =
  | { t: 'once'; start: string; end: string }
  | { t: 'week'; weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6; days?: number[] }
  | { t: 'month'; day: number }
  | { t: 'custom'; n: number; unit: 'day' | 'week' | 'month'; anchor: string };
interface ActivityTime { start: string; end: string }
interface ClueForm {
  bank: string | null; title: string; url: string; note: string;
  shots: string[];
  reward: { type: RewardType | null; value: string };
  cycle: Cycle | null; time: ActivityTime; cond: string;
}
```

- Reward display derives currency from issuer region: CNY `¥`, HKD `HK$`, MOP `MOP$`; separate totals; thousands separator and at most two decimals. Points show integer count and unit. Monetary storage remains integer minor units in existing domain, not floating point.
- One shared period-window function must drive detail/list/editor preview. Monthly day1-28: current start is this month's reset day when today day >=reset, otherwise previous month; next start one month later; end previous day; previous start one month earlier. Non-first reset explicitly identifies noncalendar month.
- Weekly: current start is today minus `(todayWeekday - resetWeekday + 7) % 7`; next start+7; end next-1; previous start-7.
- Custom day/week: length n or7n; whole periods elapsed from anchor; current anchor+k*length; next current+length. Custom months: elapsed calendar months minus1 if current day before anchor day; floor to n-month boundary; advance from anchor. Preserve repository calendar clamping and date/timezone guarantees rather than JavaScript overflow behavior.
- Once: explicit start/end, no previous or next.
- Position `(today - start + 1) / periodDayCount`; actual bar can reach0/100 outside period, today label clamped12%-88% and hidden before/after window.
- Existing period snapshot/history guarantees take precedence over prototype wording suggesting reset clears progress. A reset means a new current-period participation, while old progress, pending rewards, receipts, and operation records remain immutable/recoverable.
- OCR state needs busy, recognized image IDs, per-field provenance, suggestions, first undo snapshot; optional-rules expansion; recognized image regions. Persist actual immutable asset IDs and authorization, not `SHOTDEF` IDs in production.
- Membership needs active/exit state per user/activity/period, selected card, preserved record identity, and idempotent transitions. Never use client-only `quit` and `joined` maps as production authorization.

## Assets and prototype-only elements

All **12 supplied bank logos are 96 x 96 PNGs**, in `assets/banks`: `cmb`, `hsbc`, `boc`, `icbc`, `ccb`, `abc`, `bocom`, `citic`, `spdb`, `cib`, `pab`, `psbc`. Preserve their existing licenses/third-party notices. Logo rendering is circular white contain, not cropped.

| Bank key | Issuer color from prototype |
| --- | --- |
| cmb | `#B3302A` |
| hsbc | `#3A3430` |
| boc | `#8A2C2C` |
| icbc | `#A3362E` |
| ccb | `#2B4C7E` |
| abc | `#2F6B5B` |
| bocom | `#34467A` |
| citic | `#94392F` |
| spdb | `#3A5889` |
| cib | `#2A5A86` |
| pab | `#B4501E` |
| psbc | `#2E6A49` |

The README says these colors only affect screenshot mockups; full prototype also uses them for wallet and card-detail backgrounds. Follow the visible full prototype for the card stack/hero unless the user overrides it.

Icons are simple inline SVG, mostly24 coordinate space, 1.8-2.6 strokes with round caps/joins. Reuse matching native assets or generate local SVG/PNG from these paths; do not replace line icons with emoji. Inventory: back/next, close, repeat, clock, calendar, check, plus/minus, scan, plane, gift, history/progress, ticket/activity, card, user, edit, search, pin, chevron/disclosure, radio, WeChat capsule reference.

`ShotMock.dc.html` draws rule, entry, and blank placeholder screenshot images. It uses container-relative proportional layout. Use it only for explicitly fictional seeded demo assets or acceptance reference fixtures; production uses user-uploaded images. `ios-frame.jsx` only draws external phone shell/status/home/keyboard and is not app code. `support.js` is custom prototype runtime, not a target dependency.

The package does **not** supply a sheep illustration, avatar asset, real screenshot image collection, local DM Mono files, production OCR provider, real feedback backend, account AppID, or notification configuration. Keep missing illustrations as the clearly specified placeholder unless a replacement has separately been authorized; do not claim provided art exists.

## Prototype divergences to resolve deliberately

1. Static reference date is **2026-09-30** throughout, including receipt date, deadlines, demo logs and period algorithms; real UI must use the app's calendar/Shanghai timezone. Preserve a controlled fixture date only inside explicit demo/acceptance fixtures.
2. Intro says ten devices, but the actual overview has **twelve panels**: activities, viewer, upload, OCR completion, recognized form, date picker, custom cycle, prejoin monthly, prejoin once, joined weekly, joined custom, exit.
3. One `vmAct` completed-instant string still uses informal slang despite README's requirement to remove colloquial wording. Use formal completion copy consistent with visible detail/history states.
4. Several prototype actions merely show toasts: save photo, report, copy links, save draft, notification subscription, privacy detail. Production should use the existing actual native/service operations and report unavailable configuration truthfully.
5. Prototype can produce activity previews from simplistic owned-bank matching; actual eligibility, invitation, expiry, registration, ownership, and all backend invariants must remain enforced.
6. New design omits some already accepted production controls (direct receipt correction, shared billing identity, entitlement reversal, detailed lounge registration constraints). Keep their capability through visually consistent secondary controls instead of deleting domain behavior.
7. Custom cycle `Date` month arithmetic and README algorithm are insufficient for anchors on29-31 and before-anchor dates. Reuse the repository's validated period logic and document any extension; do not weaken period snapshots to mimic prototype code.
8. New fields (OCR, custom cycle, screenshots, exit) need both explicit demo behavior and real integration paths. A successful demo must not be described as verified cloud/OCR/device delivery.

## Native fidelity acceptance matrix

The user explicitly authorized current-task local verification and actual WeChat DevTools acceptance. Screenshot and interaction evidence must come from **native compiled source in WeChat DevTools**, with build/type/business checks separate from native visual checks. Browser reference rendering can aid comparison but does not establish Mini Program fidelity.

Required visual pairs at matching width, fixture date/data, and scroll positions:

| Reference start | Activity/scroll | Key review target |
| --- | --- | --- |
| acts | default | Bank rail, filter, new/cycle labels, split text/60x80 thumbnail, reward/action |
| viewer | d9 | Dark full viewport, first of3, image size, metadata/buttons; next/boundaries |
| submitShots | default | Screenshot first, image/add grid, recognition CTA, bank grid |
| submitOcr | default | Green completion, field capsules, missing entry, collapsed recognized bank |
| submitOcrForm | default | Auto-expanded rule fields with blue recognized styling |
| submitDate | default | Date sheet, 5-row wheels and readout; invalid date guard |
| submitCustom | default | HKD value, every3-month interval, unit/anchor preview |
| preview | d9 | Eligible monthly21 prejoin, screenshot gallery and join footer |
| preview | d2 /300 | Single-period axis, cutoff, no prior/next |
| detail | a7 /250 | Seven-day weekly timeline, today and usable weekends |
| detail | a9 /250 | Every3-month timeline, qualified status, next period |
| quit | a1 | Impact rows, registered-bank distinction, danger confirm |
| home | default and all done | Hero, upcoming rows, earnings, completion placeholder |
| cards | default | Bank-color overlapped stack, due sorting, urgent chip |
| cards/perks | each category | Selected3-column category tile, inventory identity/remaining |
| mine | user and moderator | Grouped shortcuts, explicit demo role, authorized review visibility |

Also exercise all eleven secondary views, all seven sheet types, small-width overflow, keyboard displacement, real navigation/back, screenshot event isolation, OCR manual-edit conflict/undo/additional batch, draft recovery, return/resubmit, publication gating, join/select/rejoin, exit persistence across views, historical receipt-month accounting, count/amount minimum gates, benefit usage/reversal, and actual disabled-state behavior. Collect runtime exceptions and no-op/toast-only behaviors separately from image similarity.

Record source revision/build identity, tool/device profile, fixture data/time, screenshot filenames, numeric geometry deviations, corrected findings, and remaining external integration boundaries. Do not call incomplete cloud configuration or native system-dialog limitations a fully passed real integration test.
