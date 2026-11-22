/* 그룹 스터디 서버 (v4.0): 친구끼리 그룹을 만들어 공부 시간을 나눠 보고, 목표를 같이 정하고, 함께 집중한다.
 * 앱 쪽은 js/group.js. 입구는 worker/src/index.js의 /group (로그인 확인 → 사람 번호를 만들어 → 이 파일의 groupOp)
 *
 * 저장: 모든 그룹을 작은 저장소(Durable Object) 하나에 둔다. AI 하루 횟수·벽 튕기기 순위와 같은 Counter 종류이고 이름만 'group:hub'
 *   (Firebase 사용자 번호에는 ':'가 없어 사람별 저장소와 이름이 겹치지 않는다). 한 저장소라 요청이 한 줄로 처리되어 서로 엉키지 않는다.
 *   'u:<사람>'  { n 별명, gs [그룹 번호], d { 'YYYY-MM-DD': 분 } 최근 약 2주, lv 공부 중 | null, up 마지막으로 받은 시각, tr { day, n } 틀린 초대 코드 횟수 }
 *   'g:<그룹>'  { id, name, code 초대 코드, lead 리더, at 만든 시각, goal { day 1인당 하루 목표(분), week 다 같이 한 주 목표(분) },
 *                ms [{ id, at 들어온 시각 }] 들어온 차례, ban [내보낸 사람], ch [{ f 보낸 사람, t 받은 사람, e 응원 종류, at }],
 *                room 함께 집중 { by 시작한 사람, at, end 끝나는 시각, ms [같이 하는 사람] } | null }
 *   'c:<초대 코드>'  그룹 번호
 *   'm:<그룹>'  채팅 (v4.1) { s 마지막 메시지 번호, v 마지막으로 바뀐 번호, ms [줄] } 최근 150줄·7일만
 *              줄: { s 번호, v 바뀐 번호, at, f 보낸 사람, n 그때 별명, t 글 } · 지운 메시지 { …, x: 1 본인 | 2 리더 } (글은 지운다)
 *                  자동 소식 { …, k: 'in' 들어옴 | 'out' 나감 | 'room' 함께 집중 시작 (min, end) }
 *                  붙인 것 (v4.3) { …, p: 'img' 사진 (a 파일 번호, w, h, t 설명) | 'rec' 공부 기록 카드 (r 카드, t 한마디)
 *                                     | 'deck' 단어장 (a 파일 번호, dn 덱 이름, cn 장수, pv 앞 카드 3장) }
 *   'a:<파일>'  사진 원본 { g 그룹, f 보낸 사람, at, b JPEG(base64) } 또는 단어장 { g, f, at, n 덱 이름, cs [[앞, 뒤]] }
 *   'a:<파일>:s'  사진의 작은 그림 (JPEG base64)
 *   'ax'  붙인 파일 목록 { t 모두 합한 크기, a { 파일: [그룹, 보낸 시각, 크기, 'i' 사진 | 'd' 단어장] } }  ·  'axw' 오래된 파일을 마지막으로 살핀 시각
 *         7일이 지난 파일은 한 시간마다 지운다. 메시지를 지우거나 그룹이 없어지면 바로 지운다
 *   'n'  지금 있는 그룹 수 (무료 저장 공간을 지키는 상한에 쓴다)
 *   그룹의 chatOff: 리더가 채팅을 꺼 두었으면 true. 사람의 sy { day, n, w }: 오늘 보낸 메시지 수와 최근 1분 동안 보낸 시각들
 *   사람의 ay { day, i, d }: 오늘 보낸 사진·단어장 수
 *
 * 개인정보: 사람은 Firebase 사용자 번호를 SHA-256으로 바꾼 값의 앞 16자로만 가리킨다(index.js가 만든다).
 *   이메일·구글 이름은 받지도 남기지도 않는다. 다른 사람에게 보이는 것은 별명, 날마다 공부한 분, 공부 중 표시(과목 이름은 본인이 고르면)뿐이다.
 *   그룹을 모두 나가면 그 사람의 공부 시간·공부 중 표시를 지운다.
 *
 * 앱이 보내는 것 (POST /group  { op, ... },  GET /group = op 'get')
 *   get                                     내 별명과 내가 든 그룹들
 *   sync   { d, lv, dv }                    내 최근 날별 공부 시간(분)과 공부 중 표시(재는 기기 dv)
 *   name   { n }                            별명 정하기·바꾸기 (모든 그룹에 같은 별명)
 *   create { name, goal, n? }               그룹 만들기 (만든 사람이 리더)
 *   peek   { code }                         초대 코드로 그룹 이름·인원 미리 보기
 *   join   { code, n? }                     초대 코드로 들어가기
 *   leave  { g }                            나가기 (리더가 나가면 가장 먼저 들어온 사람이 이어받고, 마지막 사람이 나가면 그룹이 없어진다)
 *   cheer  { g, m, e }                      응원 보내기 (같은 사람에게는 10분에 한 번)
 *   room   { g, min }  room-join { g }  room-leave { g }   함께 집중 시작·같이 하기·그만하기
 *   chat   { g, since }                     채팅에서 since 번호 뒤에 새로 생기거나 바뀐 줄 (since 0이면 전부). 그룹 보기 전체는 돌려주지 않는다(자주 묻는 요청이라 가볍게)
 *   say    { g, t, c?, since }              메시지 보내기 (c: 앱이 만든 번호. 답을 못 받아 다시 보내도 한 번만 들어간다)
 *          { g, p: 'img', img, th, w, h, t?, c, since }   사진 (앱이 긴 변 1600픽셀 JPEG로 다시 그린 것과 작은 그림, base64. t 설명 한 줄)
 *          { g, p: 'rec', r, t?, c, since }               공부 기록 카드 (앱이 보내는 순간 만든 숫자들. t 한마디 40자)
 *          { g, p: 'deck', deck: { n, cs }, c, since }    단어장 (덱 이름과 카드 앞·뒤 글자만, 1000장까지)
 *   unsay  { g, s, since }                  메시지 지우기 (내 메시지, 리더는 모든 메시지). 사진·단어장 파일도 바로 지운다
 *   thumbs { g, as [파일 번호 12개까지] }    작은 그림들 → { th { 파일: base64 | null } }
 *   file   { g, a }                         사진 원본 → { img, w, h } · 단어장 → { deck { n, cs } }
 *          (둘 다 그 메시지가 나에게 보일 때만: 그룹 사람이고, 들어온 뒤의 것이고, 7일 안이고, 지우지 않았고, 채팅이 켜져 있을 때)
 *   리더만: edit { g, name?, goal?, chat? }  code { g } 새 초대 코드  kick { g, m } 내보내기  lead { g, m } 리더 넘기기  unban { g }  drop { g } 그룹 없애기
 * 답: { ok, me: { id, n }, groups: [그룹 보기], lim, ...(made | joined | left | dropped | sent) }  못 할 때: { error }
 *   chat·say·unsay의 답: { ok, chat: { on, v, full, ms: [줄] } }
 *   그룹 보기의 chat: { on, v, nu [[번호, 보낸 사람] 다른 사람이 보낸 메시지, 최근 50개], tail [마지막 메시지 2개] } (앱이 '새 메시지 N'과 미리 보기를 그린다)
 *   새로 들어온 사람에게는 들어온 뒤의 줄만 보인다. 나간 사람은 그룹 사람이 아니므로 채팅도 못 본다.
 */
export const GROUP_STORE = 'group:hub';
export const LIMITS = Object.freeze({ members: 20, groups: 5, all: 3000, cheers: 40, tries: 30, ban: 50 });
export const CHEER_KINDS = 4;              // 응원 종류 수 (앱의 js/group.js CHEERS와 같다)
export const CHEER_GAP = 10 * 60 * 1000;   // 같은 사람에게 다시 응원하려면 기다리는 시간
export const ROOM_MIN = Object.freeze([10, 180]); // 함께 집중 길이(분)
export const OPS = ['get', 'sync', 'name', 'create', 'peek', 'join', 'leave', 'cheer', 'room', 'room-join', 'room-leave', 'chat', 'say', 'unsay', 'thumbs', 'file', 'edit', 'code', 'kick', 'lead', 'unban', 'drop'];
// 그룹 채팅 (v4.1): 그룹마다 최근 150줄·7일, 한 메시지 200자·8줄, 한 사람이 1초에 1개·1분에 20개·하루 300개 (모든 그룹 합해서)
export const CHAT = Object.freeze({ keep: 150, days: 7, len: 200, lines: 8, gap: 1000, perMin: 20, perDay: 300, unread: 50, tail: 2 });

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
// 채팅에 붙이는 것 (v4.3): 사진 · 공부 기록 카드 · 단어장. 붙인 것도 메시지 하나로 센다(1초 1개·1분 20개·하루 300개)
//  사진: 앱이 긴 변 1600픽셀로 줄여 다시 그린 JPEG(보통 0.2~0.4MB, 찍은 장소 같은 정보는 다시 그리며 없어짐)와 작은 그림
//  상한: 한 사람이 하루 사진 20장·단어장 10개, 그룹 하나에 7일 동안 사진 100장·단어장 50개,
//        저장소 전체에 600MB·5000개 (무료 요금제는 저장소 하나에 1GB까지라 그 아래로)
export const ATTACH = Object.freeze({
  img: 900 * 1024, thumb: 80 * 1024, side: 4096, cap: 100, memo: 40,
  photoDay: 20, photoGroup: 100, deckDay: 10, deckGroup: 50,
  cards: 1000, front: 300, back: 500, deckName: 40, deckChars: 200000, // 카드 한도는 링크로 가져오기(js/cardlink.js LIMIT)와 같다
  total: 600 * 1024 * 1024, count: 5000, thumbs: 12, sweep: HOUR,
});
const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // 헷갈리는 0·O·1·I·L은 뺀다
const ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
const CODE_RE = /^[2-9A-HJKMNP-Z]{6}$/;
const ID_RE = /^[0-9a-f]{16}$/;  // 사람 번호
const GID_RE = /^[0-9a-z]{10}$/; // 그룹 번호
const AID_RE = /^[0-9a-z]{12}$/; // 붙인 파일 번호 (v4.3)
const NICK_RE = /^[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ _-]+$/;
const GNAME_RE = /^[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ _\-·.,!?&()#+~]+$/;
const LIVE_KINDS = ['sw', 'focus', 'lock']; // 스톱워치 · 집중 타이머 · 폰 잠금 모드
const KEEP_DAYS = 17;                       // 날별 공부 시간을 남기는 날 수 (이번 주와 지난주를 보려면 14일, 날짜 경계 여유)

/* ---------- 받은 값 검사 (모양이 맞으면 깨끗한 값, 아니면 null) ---------- */
const tidy = (v) => (typeof v === 'string' ? v.normalize('NFC').replace(/\s+/g, ' ').trim() : '');
const len = (s) => [...s].length;
// 별명: 한글·영어·숫자·빈칸·_·-만 1~12자 (벽 튕기기 순위의 별명과 같은 규칙)
export function cleanNick(v) { const s = tidy(v); return s && len(s) <= 12 && NICK_RE.test(s) ? s : null; }
// 그룹 이름: 별명 글자에 · . , ! ? & ( ) # + ~ 를 더해 1~20자
export function cleanGroupName(v) { const s = tidy(v); return s && len(s) <= 20 && GNAME_RE.test(s) ? s : null; }
// 초대 코드: 대문자 6자. 소문자·빈칸·'-'은 받아 준다
export function cleanCode(v) {
  if (typeof v !== 'string') return null;
  const s = v.toUpperCase().replace(/[\s-]/g, '');
  return CODE_RE.test(s) ? s : null;
}
// 목표: { day: 1인당 하루 0~1440분, week: 다 같이 한 주 0~60000분(1000시간) }. 0이면 목표 없음
export function cleanGoal(g) {
  if (g == null) return { day: 0, week: 0 };
  if (typeof g !== 'object' || Array.isArray(g)) return null;
  const int = (v, hi) => (v == null ? 0 : Number.isInteger(v) && v >= 0 && v <= hi ? v : -1);
  const day = int(g.day, 1440), week = int(g.week, 60000);
  return day < 0 || week < 0 ? null : { day, week };
}
// 과목 이름(공부 중 표시에 붙는다): 보이지 않는 글자·줄바꿈을 빼고 20자까지
export function cleanSubject(v) {
  if (typeof v !== 'string') return null;
  const s = v.normalize('NFC').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').replace(/\s+/g, ' ').trim();
  return s ? [...s].slice(0, 20).join('') : null;
}
// 채팅 글: 줄바꿈은 남기고(빈 줄은 하나까지) 보이지 않는 글자·방향 바꾸는 글자는 뺀다 (이모지를 잇는 ZWJ는 남긴다). 1~200자, 8줄까지. 아니면 null
export function cleanMsg(v) {
  if (typeof v !== 'string') return null;
  const s = v.normalize('NFC').replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u00AD\u200B\u200C\u200E\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .split('\n').map((l) => l.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
  if (!s || [...s].length > CHAT.len || s.split('\n').length > CHAT.lines) return null;
  return s;
}

/* ---------- 채팅에 붙이는 것 (v4.3) ---------- */
// base64 글자가 나타내는 바이트 수 (모양이 틀리면 -1)
export function b64Size(s) {
  if (typeof s !== 'string' || !s || s.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return -1;
  return (s.length / 4) * 3 - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0);
}
// JPEG 사진 (FF D8 FF로 시작 = base64 '/9j/'), max 바이트까지. 맞으면 바이트 수, 아니면 0
export function jpegSize(s, max) {
  const n = b64Size(s);
  return n > 0 && n <= max && s.startsWith('/9j/') ? n : 0;
}
// 사진 설명·공부 기록 한마디: 한 줄(줄바꿈은 빈칸으로), max자까지. 없으면 '', 틀리면 null
export function cleanCaption(v, max) {
  if (v == null || v === '') return '';
  if (typeof v !== 'string') return null;
  const s = cleanMsg(v.replace(/[\r\n]+/g, ' '));
  return s && [...s].length <= max ? s : null;
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const nat = (v, hi) => Number.isInteger(v) && v >= 0 && v <= hi;
// 공부 기록 카드 (앱이 보내는 순간 만든 숫자들. 할 일 제목·메모·시험 범위는 들어 있지 않다)
//  { sp 'd' 오늘 | 'w' 이번 주, d 그날(주는 월요일), e 주의 마지막 날(오늘), m 공부한 분, g 하루 목표(분), fo 집중 타이머 횟수,
//    td [끝낸 할 일, 할 일], sk 연속 공부일, sb [{ n? 과목 이름(없으면 숨김), m 분, c 색, x? 과목 없음 }] 많은 순 5개, o 나머지 과목 분 }
export function cleanRecord(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  if ((r.sp !== 'd' && r.sp !== 'w') || !DATE_RE.test(r.d)) return null;
  const out = { sp: r.sp, d: r.d };
  if (r.sp === 'w') {
    if (!DATE_RE.test(r.e) || r.e < r.d) return null;
    const span = (Date.parse(r.e + 'T00:00:00Z') - Date.parse(r.d + 'T00:00:00Z')) / DAY;
    if (!(span >= 0 && span <= 6)) return null;
    out.e = r.e;
  }
  const most = r.sp === 'w' ? 7 * 1440 : 1440;
  if (!nat(r.m, most) || !nat(r.g, 1440) || !nat(r.fo, 999) || !nat(r.sk, 9999) || !nat(r.o || 0, most)) return null;
  if (!Array.isArray(r.td) || r.td.length !== 2 || !nat(r.td[0], 999) || !nat(r.td[1], 999) || r.td[0] > r.td[1]) return null;
  if (!Array.isArray(r.sb) || r.sb.length > 5) return null;
  const sb = [];
  for (const x of r.sb) {
    if (!x || typeof x !== 'object' || Array.isArray(x) || !nat(x.m, most)) return null;
    const o = { m: x.m, c: typeof x.c === 'string' && COLOR_RE.test(x.c) ? x.c.toLowerCase() : '' };
    if (x.x) o.x = 1;
    else if (x.n != null && x.n !== '') { const n = cleanSubject(x.n); if (!n) return null; o.n = n; }
    sb.push(o);
  }
  Object.assign(out, { m: r.m, g: r.g, fo: r.fo, td: [r.td[0], r.td[1]], sk: r.sk, sb, o: r.o || 0 });
  return out;
}
// 카드 글자: 보이지 않는 글자는 빼고 빈칸을 하나로 (링크로 가져오기의 clean과 같게, 다만 길면 자르지 않고 거절)
const cardText = (v, max) => {
  if (typeof v !== 'string') return null;
  const s = v.normalize('NFC').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return s && [...s].length <= max ? s : null;
};
// 단어장 { n 덱 이름, cs [[앞, 뒤], …] } → 깨끗한 덱, 아니면 null. 복습 기록(외운 정도·다음 날짜)은 받지 않는다
export function cleanDeck(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d) || !Array.isArray(d.cs)) return null;
  if (!d.cs.length || d.cs.length > ATTACH.cards) return null;
  const n = d.n == null || d.n === '' ? '단어장' : cardText(d.n, ATTACH.deckName);
  if (!n) return null;
  const cs = [];
  let chars = 0;
  for (const c of d.cs) {
    if (!Array.isArray(c) || c.length !== 2) return null;
    const f = cardText(c[0], ATTACH.front), b = cardText(c[1], ATTACH.back);
    if (!f || !b) return null;
    chars += f.length + b.length;
    cs.push([f, b]);
  }
  return chars <= ATTACH.deckChars ? { n, cs } : null;
}
// 메시지에 담는 앞 카드 3장 (미리 보기라 60자까지)
const cut = (s, n) => ([...s].length > n ? [...s].slice(0, n - 1).join('') + '…' : s);
const fmMin = (m) => (m < 60 ? m + '분' : Math.floor(m / 60) + '시간' + (m % 60 ? ' ' + (m % 60) + '분' : ''));
// 붙인 것을 그리지 못하는 예전 앱(4.2까지)에 보이는 글
export function altText(x) {
  if (x.p === 'img') return '📷 사진' + (x.t ? ' · ' + x.t : '');
  if (x.p === 'rec') return `📊 ${x.r.sp === 'w' ? '이번 주' : '오늘'} 공부 ${fmMin(x.r.m)}` + (x.t ? ' · ' + x.t : '');
  if (x.p === 'deck') return `🗂️ 단어장 ‘${x.dn}’ 카드 ${x.cn}장`;
  return x.t;
}
const utcKey = (t) => new Date(t).toISOString().slice(0, 10);
// 날별 공부 시간 { 'YYYY-MM-DD': 0~1440 정수 }. 모양이 틀리면 null, 너무 오래되었거나 먼 날은 버린다(기기 시계가 틀린 경우)
export function cleanDays(d, now) {
  if (d == null) return {};
  if (typeof d !== 'object' || Array.isArray(d)) return null;
  const keys = Object.keys(d);
  if (keys.length > 40) return null;
  const lo = utcKey(now - KEEP_DAYS * DAY), hi = utcKey(now + 2 * DAY);
  const out = {};
  for (const k of keys) {
    const v = d[k];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !Number.isInteger(v) || v < 0 || v > 1440) return null;
    if (k >= lo && k <= hi && v > 0) out[k] = v;
  }
  return out;
}
// 공부 중 표시 { k 무엇으로 재는지, at 시작, end 끝나는 시각(타이머·잠금), s 과목 이름 }. 이상하거나 이미 끝난 것은 null (공부 중 아님)
export function cleanLive(lv, now) {
  if (!lv || typeof lv !== 'object' || Array.isArray(lv) || !LIVE_KINDS.includes(lv.k)) return null;
  if (!Number.isInteger(lv.at) || lv.at > now + MIN) return null;
  const out = { k: lv.k, at: lv.at };
  if (lv.end != null) {
    if (!Number.isInteger(lv.end) || lv.end <= lv.at || lv.end - lv.at > 12 * HOUR) return null;
    out.end = lv.end;
  }
  const s = cleanSubject(lv.s);
  if (s) out.s = s;
  return liveOn(out, now) ? out : null;
}
// 지금도 공부 중인가: 끝나는 시각이 있으면 그 전까지, 스톱워치는 시작한 지 16시간까지 (켜 둔 채 잊은 스톱워치)
export function liveOn(lv, now) {
  return !!lv && lv.at <= now + MIN && (lv.end ? lv.end > now : now - lv.at < 16 * HOUR);
}
const publicLive = (lv) => Object.assign({ k: lv.k, at: lv.at }, lv.end ? { end: lv.end } : null, lv.s ? { s: lv.s } : null);
// 남겨 둘 날만 (오래 앱을 안 연 사람의 지난 기록이 계속 오가지 않게)
function recentDays(d, now) {
  const lo = utcKey(now - KEEP_DAYS * DAY), out = {};
  for (const k in d || {}) if (k >= lo) out[k] = d[k];
  return out;
}

// 고르게 뽑은 글자 n개 (치우침이 없게 남는 값은 버린다)
function randomText(abc, n) {
  const cut = 256 - (256 % abc.length);
  let s = '';
  while (s.length < n) {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    for (const v of b) if (s.length < n && v < cut) s += abc[v % abc.length];
  }
  return s;
}
const newUser = () => ({ n: null, gs: [], d: {}, lv: null, up: 0 });

/* ---------- 요청 하나 처리 ----------
 * st: 저장소(get·put·delete), msg: { op, id 사람 번호, at 지금 시각, b 앱이 보낸 본문 }
 * 저장소만 기다리고 다른 곳(인터넷)을 기다리지 않으므로, 읽고 고쳐 쓰는 동안 다른 요청이 끼어들지 않는다
 */
export async function groupOp(st, msg) {
  const op = String((msg && msg.op) || '').replace(/^group-/, '');
  const id = String((msg && msg.id) || ''), now = msg && msg.at;
  const b = msg && msg.b && typeof msg.b === 'object' && !Array.isArray(msg.b) ? msg.b : {};
  if (!ID_RE.test(id) || !Number.isFinite(now) || !OPS.includes(op)) return { error: 'bad' };
  const today = utcKey(now);

  // 이번 요청에서 읽은 사람 기록 (같은 사람을 여러 번 읽지 않고, 고친 것이 바로 보이게)
  const users = new Map();
  const getU = async (x) => { if (!users.has(x)) users.set(x, (await st.get('u:' + x)) || null); return users.get(x); };
  const putU = async (x, u) => { users.set(x, u); await st.put('u:' + x, u); };

  /* 채팅 */
  const joinedAt = (g, who) => { const m = g.ms.find((x) => x.id === who); return m ? m.at : Infinity; };
  const chatOf = async (gid) => (await st.get('m:' + gid)) || { s: 0, v: 0, ms: [] };
  const fresh = (x) => now - x.at < CHAT.days * DAY;
  // 앱에 보내는 한 줄 (앱이 만든 번호 c는 보낸 사람에게만)
  //  붙인 것: p와 그 내용, cap(사진 설명·공부 기록 한마디), t는 그리지 못하는 예전 앱과 미리 보기에 쓰는 글
  function line(x) {
    const o = { s: x.s, v: x.v, at: x.at, f: x.f, n: x.n };
    if (x.k) { o.k = x.k; if (x.k === 'room') { o.min = x.min; o.end = x.end; } }
    else if (x.x) o.x = x.x;
    else if (x.p) {
      o.p = x.p; o.t = altText(x);
      if (x.t) o.cap = x.t;
      if (x.p === 'img') Object.assign(o, { a: x.a, w: x.w, h: x.h });
      else if (x.p === 'rec') o.r = x.r;
      else if (x.p === 'deck') Object.assign(o, { a: x.a, dn: x.dn, cn: x.cn, pv: x.pv });
    } else o.t = x.t;
    if (x.c && x.f === id) o.c = x.c;
    return o;
  }
  // 나에게 보이는 줄: 7일 안, 내가 들어온 뒤
  const seen = (g, c) => { const from = joinedAt(g, id); return c.ms.filter((x) => fresh(x) && x.at >= from); };
  // since 번호 뒤에 생기거나 바뀐 줄 (since가 없거나 이상하면 전부, full: true)
  function chatView(g, c, since) {
    const all = !Number.isInteger(since) || since <= 0 || since > c.v;
    const on = !g.chatOff;
    return { on, v: c.v, full: all, ms: on ? seen(g, c).filter((x) => all || x.v > since).map(line) : [] };
  }
  // 줄 하나 더하기 (오래된 줄·150줄 넘는 것은 버린다. 버린 줄의 사진·단어장 파일도 지운다)
  async function addLine(g, x) {
    const c = await chatOf(g.id);
    c.s += 1; c.v += 1;
    c.ms.push(Object.assign({ s: c.s, v: c.v, at: now }, x));
    const keep = c.ms.filter(fresh).slice(-CHAT.keep);
    const gone = c.ms.filter((m) => m.a && !keep.includes(m)).map((m) => m.a);
    c.ms = keep;
    await st.put('m:' + g.id, c);
    if (gone.length) await dropFiles(gone);
    return c;
  }

  /* 붙인 파일 (v4.3) */
  const filesOf = async () => (await st.get('ax')) || { t: 0, a: {} };
  const fileKeys = (aid, kind) => (kind === 'i' ? ['a:' + aid, 'a:' + aid + ':s'] : ['a:' + aid]);
  // 파일 지우기 (목록에서 빼고 크기를 덜어 낸다)
  async function dropFiles(aids, ax) {
    ax = ax || (await filesOf());
    let hit = false;
    for (const aid of aids) {
      const e = ax.a[aid];
      if (!e) continue;
      await st.delete(fileKeys(aid, e[3]));
      ax.t = Math.max(0, ax.t - e[2]);
      delete ax.a[aid];
      hit = true;
    }
    if (hit) await st.put('ax', ax);
    return ax;
  }
  // 한 시간마다: 7일이 지난 파일과 그 줄을 지운다 (채팅이 조용한 그룹도)
  async function sweep() {
    const last = (await st.get('axw')) || 0;
    if (now - last < ATTACH.sweep && last <= now) return;
    const ax = await st.get('ax');
    if (!ax || !Object.keys(ax.a).length) return; // 붙인 파일이 없으면 아무것도 쓰지 않는다
    await st.put('axw', now);
    const old = Object.keys(ax.a).filter((aid) => now - ax.a[aid][1] >= CHAT.days * DAY);
    if (!old.length) return;
    const gids = new Set(old.map((aid) => ax.a[aid][0]));
    await dropFiles(old, ax);
    for (const gid of gids) {
      const c = await st.get('m:' + gid);
      if (c && c.ms.some((m) => !fresh(m))) { c.ms = c.ms.filter(fresh); await st.put('m:' + gid, c); }
    }
  }
  // 나에게 보이는 줄 중에서 그 파일이 붙은 줄 (지운 줄·채팅을 꺼 둔 그룹은 없음)
  const fileLine = (g, c, aid) => (g.chatOff ? null : seen(g, c).find((x) => x.a === aid && x.p && !x.x) || null);
  async function chatSummary(g) {
    if (g.chatOff) return { on: false, v: 0, nu: [], tail: [] };
    const c = await st.get('m:' + g.id);
    if (!c) return { on: true, v: 0, nu: [], tail: [] };
    const talk = seen(g, c).filter((x) => !x.k && !x.x);
    return { on: true, v: c.v, nu: talk.filter((x) => x.f !== id).slice(-CHAT.unread).map((x) => [x.s, x.f]), tail: talk.slice(-CHAT.tail).map(line) };
  }

  async function view(g) {
    const ms = [];
    for (const m of g.ms) {
      const u = await getU(m.id);
      ms.push({ id: m.id, n: (u && u.n) || '?', at: m.at, d: recentDays(u && u.d, now), lv: u && liveOn(u.lv, now) ? publicLive(u.lv) : null, up: (u && u.up) || 0 });
    }
    const room = g.room && g.room.end > now ? { by: g.room.by, at: g.room.at, end: g.room.end, ms: g.room.ms.slice() } : null;
    const out = { id: g.id, name: g.name, code: g.code, lead: g.lead, at: g.at, goal: g.goal, ms, ch: (g.ch || []).filter((c) => now - c.at < 7 * DAY), room, chat: await chatSummary(g) };
    if (g.lead === id) out.ban = (g.ban || []).length; // 리더에게만: 내보낸 사람 수 (다시 받기 단추)
    return out;
  }
  // 내 별명과 그룹들. 없어진 그룹 번호가 남아 있으면 이참에 지운다
  async function state(extra) {
    const u = await getU(id);
    const groups = [], keep = [];
    for (const gid of (u && u.gs) || []) {
      const g = await st.get('g:' + gid);
      if (!g || !g.ms.some((m) => m.id === id)) continue;
      keep.push(gid);
      groups.push(await view(g));
    }
    if (u && keep.length !== u.gs.length) { u.gs = keep; await putU(id, u); }
    return Object.assign({ ok: true, me: { id, n: (u && u.n) || null }, groups, lim: { members: LIMITS.members, groups: LIMITS.groups } }, extra || null);
  }
  // 별명을 같이 보냈으면 정하고, 그래도 별명이 없으면 'name' (그룹에 들려면 별명이 있어야 한다)
  async function withNick() {
    const u = (await getU(id)) || newUser();
    if (b.n != null && b.n !== '') {
      const n = cleanNick(b.n);
      if (!n) return { error: 'badname' };
      u.n = n;
    }
    return u.n ? { u } : { error: 'name' };
  }
  async function freshCode() {
    for (let i = 0; i < 50; i++) { const c = randomText(CODE_CHARS, 6); if (!(await st.get('c:' + c))) return c; }
    throw new Error('code');
  }
  async function byCode(code) {
    const gid = await st.get('c:' + code);
    return gid ? (await st.get('g:' + gid)) || null : null;
  }
  // 틀린 초대 코드 횟수 (코드를 마구 넣어 남의 그룹을 찾지 못하게, 하루 30번)
  const tried = (u) => (u && u.tr && u.tr.day === today ? u.tr.n : 0);
  async function countTry(u) { u = u || newUser(); u.tr = { day: today, n: tried(u) + 1 }; await putU(id, u); }
  // 내가 든 그룹 (b.g)
  async function mine() {
    if (typeof b.g !== 'string' || !GID_RE.test(b.g)) return null;
    const g = await st.get('g:' + b.g);
    return g && g.ms.some((m) => m.id === id) ? g : null;
  }
  async function led() {
    const g = await mine();
    if (!g) return { error: 'nogroup' };
    return g.lead === id ? { g } : { error: 'lead' };
  }
  const isMember = (g, m) => typeof m === 'string' && g.ms.some((x) => x.id === m);
  // 그룹을 모두 나간 사람: 공부 시간·공부 중 표시를 지운다 (별명은 다음에 쓰도록 남긴다)
  const forget = (u) => { if (!u.gs.length) { u.d = {}; u.lv = null; } };
  async function dropGroup(g) {
    for (const m of g.ms) {
      const u = await getU(m.id);
      if (u) { u.gs = u.gs.filter((x) => x !== g.id); forget(u); await putU(m.id, u); }
    }
    await st.delete('g:' + g.id);
    await st.delete('m:' + g.id);
    const ax = await st.get('ax');
    if (ax) await dropFiles(Object.keys(ax.a).filter((aid) => ax.a[aid][0] === g.id), ax);
    if ((await st.get('c:' + g.code)) === g.id) await st.delete('c:' + g.code);
    await st.put('n', Math.max(0, ((await st.get('n')) || 1) - 1));
  }
  async function removeMember(g, who) {
    g.ms = g.ms.filter((m) => m.id !== who);
    const u = await getU(who);
    if (u) { u.gs = u.gs.filter((x) => x !== g.id); forget(u); await putU(who, u); }
    if (!g.ms.length) return dropGroup(g);
    if (g.lead === who) g.lead = g.ms[0].id; // 리더가 나가면 가장 먼저 들어온 사람이 이어받는다
    g.ch = (g.ch || []).filter((c) => c.f !== who && c.t !== who);
    if (g.room) { g.room.ms = g.room.ms.filter((x) => x !== who); if (!g.room.ms.length) g.room = null; }
    await st.put('g:' + g.id, g);
  }

  await sweep(); // 7일이 지난 사진·단어장 지우기 (한 시간에 한 번만 살핀다)

  switch (op) {
    case 'get': return state();

    case 'sync': {
      const u = await getU(id);
      if (!u || !u.gs.length) return state(); // 그룹에 들지 않은 사람의 공부 시간은 받지 않는다
      const d = cleanDays(b.d, now);
      if (!d) return { error: 'bad' };
      const dv = typeof b.dv === 'string' && /^[0-9a-z]{1,16}$/.test(b.dv) ? b.dv : '';
      let lv = cleanLive(b.lv, now);
      if (lv && dv) lv.dv = dv;
      // 다른 기기가 재는 중인 공부 중 표시는 이 기기가 지우지 않는다 (재는 기기가 멈출 때 지운다)
      if (!lv && u.lv && liveOn(u.lv, now) && u.lv.dv && dv && u.lv.dv !== dv) lv = u.lv;
      u.d = d; u.lv = lv; u.up = now;
      await putU(id, u);
      return state();
    }

    case 'name': {
      const n = cleanNick(b.n);
      if (!n) return { error: 'badname' };
      const u = (await getU(id)) || newUser();
      u.n = n;
      await putU(id, u);
      return state();
    }

    case 'create': {
      const name = cleanGroupName(b.name);
      if (!name) return { error: 'gname' };
      const goal = cleanGoal(b.goal);
      if (!goal) return { error: 'bad' };
      const r = await withNick();
      if (r.error) return r;
      const u = r.u;
      if (u.gs.length >= LIMITS.groups) return { error: 'many' };
      const total = (await st.get('n')) || 0;
      if (total >= LIMITS.all) return { error: 'busy' };
      let gid = randomText(ID_CHARS, 10);
      while (await st.get('g:' + gid)) gid = randomText(ID_CHARS, 10);
      const code = await freshCode();
      const g = { id: gid, name, code, lead: id, at: now, goal, ms: [{ id, at: now }], ban: [], ch: [], room: null };
      u.gs.push(gid);
      await st.put('g:' + gid, g);
      await st.put('c:' + code, gid);
      await st.put('n', total + 1);
      await putU(id, u);
      return state({ made: gid });
    }

    case 'peek': {
      const code = cleanCode(b.code);
      if (!code) return { error: 'code' };
      const u = await getU(id);
      if (tried(u) >= LIMITS.tries) return { error: 'slow' };
      const g = await byCode(code);
      if (!g) { await countTry(u); return { error: 'code' }; }
      const lead = await getU(g.lead);
      return {
        ok: true, me: { id, n: (u && u.n) || null },
        peek: { id: g.id, name: g.name, count: g.ms.length, max: LIMITS.members, lead: (lead && lead.n) || null, goal: g.goal,
          member: g.ms.some((m) => m.id === id), banned: (g.ban || []).includes(id), full: g.ms.length >= LIMITS.members },
      };
    }

    case 'join': {
      const code = cleanCode(b.code);
      if (!code) return { error: 'code' };
      if (tried(await getU(id)) >= LIMITS.tries) return { error: 'slow' };
      const g = await byCode(code);
      if (!g) { await countTry(await getU(id)); return { error: 'code' }; }
      if (g.ms.some((m) => m.id === id)) return state({ joined: g.id }); // 이미 들어와 있음
      if ((g.ban || []).includes(id)) return { error: 'banned' };
      if (g.ms.length >= LIMITS.members) return { error: 'full' };
      const r = await withNick();
      if (r.error) return r;
      const u = r.u;
      if (u.gs.length >= LIMITS.groups) return { error: 'many' };
      g.ms.push({ id, at: now });
      u.gs.push(g.id);
      await st.put('g:' + g.id, g);
      await putU(id, u);
      await addLine(g, { k: 'in', f: id, n: u.n });
      return state({ joined: g.id });
    }

    case 'leave': {
      const g = await mine();
      if (!g) return { error: 'nogroup' };
      const u = await getU(id);
      await removeMember(g, id);
      if (g.ms.length) await addLine(g, { k: 'out', f: id, n: (u && u.n) || '?' });
      return state({ left: g.id });
    }

    case 'cheer': {
      const g = await mine();
      if (!g) return { error: 'nogroup' };
      if (b.m === id || !isMember(g, b.m) || !Number.isInteger(b.e) || b.e < 0 || b.e >= CHEER_KINDS) return { error: 'bad' };
      g.ch = (g.ch || []).filter((c) => now - c.at < 7 * DAY);
      if (g.ch.some((c) => c.f === id && c.t === b.m && now - c.at < CHEER_GAP)) return { error: 'wait' };
      g.ch.push({ f: id, t: b.m, e: b.e, at: now });
      g.ch = g.ch.slice(-LIMITS.cheers);
      await st.put('g:' + g.id, g);
      return state({ sent: true });
    }

    case 'room': { // 함께 집중 시작: 같은 시각에 끝나는 집중 타이머를 그룹 사람들이 같이 켠다
      const g = await mine();
      if (!g) return { error: 'nogroup' };
      if (!Number.isInteger(b.min) || b.min < ROOM_MIN[0] || b.min > ROOM_MIN[1]) return { error: 'bad' };
      if (g.room && g.room.end > now) return { error: 'room' }; // 이미 하는 중: 앱은 '같이 하기'를 보여 준다
      g.room = { by: id, at: now, end: now + b.min * MIN, ms: [id] };
      await st.put('g:' + g.id, g);
      const u = await getU(id);
      await addLine(g, { k: 'room', f: id, n: (u && u.n) || '?', min: b.min, end: g.room.end });
      return state();
    }
    case 'room-join': {
      const g = await mine();
      if (!g) return { error: 'nogroup' };
      if (!g.room || g.room.end <= now) return { error: 'noroom' };
      if (!g.room.ms.includes(id)) { g.room.ms.push(id); await st.put('g:' + g.id, g); }
      return state();
    }
    case 'room-leave': {
      const g = await mine();
      if (!g) return { error: 'nogroup' };
      if (g.room && g.room.ms.includes(id)) {
        g.room.ms = g.room.ms.filter((x) => x !== id);
        if (!g.room.ms.length || g.room.end <= now) g.room = null;
        await st.put('g:' + g.id, g);
      }
      return state();
    }

    /* 채팅 */
    case 'chat': {
      const g = await mine();
      if (!g) return { error: 'nogroup' };
      return { ok: true, chat: chatView(g, await chatOf(g.id), b.since) };
    }
    case 'say': {
      const g = await mine();
      if (!g) return { error: 'nogroup' };
      if (g.chatOff) return { error: 'chatoff' };
      // 무엇을 보내나: 글 · 사진 · 공부 기록 카드 · 단어장 (v4.3). 모양이 틀리면 아무것도 넣지 않는다
      const p = b.p == null ? '' : b.p;
      let x, file = null;
      if (p === '') {
        const t = cleanMsg(b.t);
        if (!t) return { error: 'bad' };
        x = { t };
      } else if (p === 'img') {
        const t = cleanCaption(b.t, ATTACH.cap);
        const full = jpegSize(b.img, ATTACH.img), small = jpegSize(b.th, ATTACH.thumb);
        if (t == null || !nat(b.w, ATTACH.side) || !nat(b.h, ATTACH.side) || !b.w || !b.h) return { error: 'bad' };
        if (!full || !small) return { error: b64Size(b.img) > ATTACH.img || b64Size(b.th) > ATTACH.thumb ? 'big' : 'bad' };
        x = { p, w: b.w, h: b.h };
        if (t) x.t = t;
        file = { kind: 'i', size: b.img.length + b.th.length };
      } else if (p === 'rec') {
        const r = cleanRecord(b.r), t = cleanCaption(b.t, ATTACH.memo);
        if (!r || t == null) return { error: 'bad' };
        x = { p, r };
        if (t) x.t = t;
      } else if (p === 'deck') {
        const d = cleanDeck(b.deck);
        if (!d) return { error: Array.isArray(b.deck && b.deck.cs) && b.deck.cs.length > ATTACH.cards ? 'big' : 'bad' };
        const json = JSON.stringify(d);
        x = { p, dn: d.n, cn: d.cs.length, pv: d.cs.slice(0, 3).map(([f, bk]) => [cut(f, 60), cut(bk, 60)]) };
        file = { kind: 'd', size: json.length * (/[^\u0000-ÿ]/.test(json) ? 2 : 1), deck: d };
      } else return { error: 'bad' };
      const cid = typeof b.c === 'string' && /^[0-9a-z]{6,16}$/.test(b.c) ? b.c : '';
      const had = await chatOf(g.id);
      // 같은 메시지를 다시 보냄 (보냈는데 답을 못 받은 경우): 또 넣지 않는다
      if (cid && had.ms.some((m) => m.f === id && m.c === cid)) return { ok: true, chat: chatView(g, had, b.since) };
      const u = await getU(id);
      if (!u || !u.n) return { error: 'name' };
      const w = ((u.sy && u.sy.w) || []).filter((v) => now - v < MIN && v <= now);
      const n = u.sy && u.sy.day === today ? u.sy.n : 0;
      if (n >= CHAT.perDay) return { error: 'daymax' };
      if (w.length >= CHAT.perMin || (w.length && now - w[w.length - 1] < CHAT.gap)) return { error: 'fast' };
      let ax = null;
      if (file) {
        // 사진·단어장 상한: 나(하루), 그룹(7일), 저장소 전체(크기·개수)
        const ay = u.ay && u.ay.day === today ? u.ay : { day: today, i: 0, d: 0 };
        ax = await filesOf();
        const week = Object.values(ax.a).filter((e) => e[0] === g.id && e[3] === file.kind && now - e[1] < CHAT.days * DAY).length;
        if (file.kind === 'i' && ay.i >= ATTACH.photoDay) return { error: 'photoday' };
        if (file.kind === 'd' && ay.d >= ATTACH.deckDay) return { error: 'deckday' };
        if (week >= (file.kind === 'i' ? ATTACH.photoGroup : ATTACH.deckGroup)) return { error: file.kind === 'i' ? 'photogroup' : 'deckgroup' };
        if (ax.t + file.size > ATTACH.total || Object.keys(ax.a).length >= ATTACH.count) return { error: 'space' };
        u.ay = Object.assign({}, ay, file.kind === 'i' ? { i: ay.i + 1 } : { d: ay.d + 1 });
      }
      u.sy = { day: today, n: n + 1, w: w.concat(now) };
      await putU(id, u);
      if (file) {
        let aid = randomText(ID_CHARS, 12);
        while (ax.a[aid]) aid = randomText(ID_CHARS, 12);
        if (file.kind === 'i') {
          await st.put('a:' + aid, { g: g.id, f: id, at: now, b: b.img });
          await st.put('a:' + aid + ':s', b.th);
        } else await st.put('a:' + aid, { g: g.id, f: id, at: now, n: file.deck.n, cs: file.deck.cs });
        ax.a[aid] = [g.id, now, file.size, file.kind];
        ax.t += file.size;
        await st.put('ax', ax);
        x.a = aid;
      }
      Object.assign(x, { f: id, n: u.n });
      if (cid) x.c = cid;
      return { ok: true, chat: chatView(g, await addLine(g, x), b.since) };
    }
    case 'unsay': {
      const g = await mine();
      if (!g) return { error: 'nogroup' };
      if (!Number.isInteger(b.s)) return { error: 'bad' };
      const c = await chatOf(g.id);
      const x = c.ms.find((m) => m.s === b.s && fresh(m));
      if (!x || x.k) return { error: 'gone' }; // 자동 소식은 지우지 않는다
      if (x.f !== id && g.lead !== id) return { error: 'lead' };
      if (!x.x) {
        const aid = x.a;
        for (const k of ['t', 'c', 'p', 'a', 'w', 'h', 'r', 'dn', 'cn', 'pv']) delete x[k]; // 글과 붙인 것 모두
        x.x = x.f === id ? 1 : 2;
        c.v += 1; x.v = c.v;
        await st.put('m:' + g.id, c);
        if (aid) await dropFiles([aid]); // 사진·단어장 파일도 서버에서 바로 지운다
      }
      return { ok: true, chat: chatView(g, c, b.since) };
    }
    case 'thumbs': { // 작은 그림 여러 장 (채팅 창에 보이는 사진들)
      const g = await mine();
      if (!g) return { error: 'nogroup' };
      if (g.chatOff) return { error: 'chatoff' };
      const as = Array.isArray(b.as) ? [...new Set(b.as)] : [];
      if (!as.length || as.length > ATTACH.thumbs || !as.every((a) => typeof a === 'string' && AID_RE.test(a))) return { error: 'bad' };
      const c = await chatOf(g.id), th = {};
      for (const a of as) {
        const x = fileLine(g, c, a);
        th[a] = x && x.p === 'img' ? (await st.get('a:' + a + ':s')) || null : null;
      }
      return { ok: true, th };
    }
    case 'file': { // 사진 원본 하나 · 단어장 하나
      const g = await mine();
      if (!g) return { error: 'nogroup' };
      if (g.chatOff) return { error: 'chatoff' };
      if (typeof b.a !== 'string' || !AID_RE.test(b.a)) return { error: 'bad' };
      const x = fileLine(g, await chatOf(g.id), b.a);
      const f = x && (await st.get('a:' + b.a));
      if (!f || f.g !== g.id) return { error: 'gone' };
      return x.p === 'img' ? { ok: true, img: f.b, w: x.w, h: x.h } : { ok: true, deck: { n: f.n, cs: f.cs } };
    }

    /* 리더만 */
    case 'edit': {
      const r = await led();
      if (r.error) return r;
      const g = r.g;
      if (b.name == null && b.goal == null && b.chat == null) return { error: 'bad' };
      if (b.chat != null && typeof b.chat !== 'boolean') return { error: 'bad' };
      if (b.name != null) { const name = cleanGroupName(b.name); if (!name) return { error: 'gname' }; g.name = name; }
      if (b.goal != null) { const goal = cleanGoal(b.goal); if (!goal) return { error: 'bad' }; g.goal = goal; }
      if (b.chat === false) g.chatOff = true; // 끄면 아무도 보내지 못하고 지난 메시지도 숨는다 (7일이 지나면 저절로 지워진다)
      else if (b.chat === true) delete g.chatOff;
      await st.put('g:' + g.id, g);
      return state();
    }
    case 'code': { // 새 초대 코드: 예전 코드로는 더 못 들어온다
      const r = await led();
      if (r.error) return r;
      const g = r.g, code = await freshCode();
      if ((await st.get('c:' + g.code)) === g.id) await st.delete('c:' + g.code);
      g.code = code;
      await st.put('c:' + code, g.id);
      await st.put('g:' + g.id, g);
      return state();
    }
    case 'kick': { // 내보내기: 같은 그룹에 다시 들어오지 못한다 (리더가 '다시 받기'를 누를 때까지)
      const r = await led();
      if (r.error) return r;
      const g = r.g;
      if (b.m === id || !isMember(g, b.m)) return { error: 'bad' };
      g.ban = (g.ban || []).filter((x) => x !== b.m).concat(b.m).slice(-LIMITS.ban);
      await removeMember(g, b.m);
      return state();
    }
    case 'lead': {
      const r = await led();
      if (r.error) return r;
      const g = r.g;
      if (b.m === id || !isMember(g, b.m)) return { error: 'bad' };
      g.lead = b.m;
      await st.put('g:' + g.id, g);
      return state();
    }
    case 'unban': {
      const r = await led();
      if (r.error) return r;
      r.g.ban = [];
      await st.put('g:' + r.g.id, r.g);
      return state();
    }
    case 'drop': {
      const r = await led();
      if (r.error) return r;
      await dropGroup(r.g);
      return state({ dropped: r.g.id });
    }
  }
  return { error: 'bad' };
}
