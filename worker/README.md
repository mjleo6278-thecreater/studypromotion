# 스터디 프로모션 AI 도우미 서버 (Cloudflare Worker)

앱의 AI 도우미(js/ai.js)가 부르는 서버입니다. 로그인 확인 → 하루 횟수 세기 → Workers AI 모델에 묻기 → 답을 조금씩 앱으로 보냅니다.

v3.9부터 이스터에그 게임 '벽 튕기기'(js/bounce.js)의 전체 순위도 맡습니다 (`GET /bounce`, `POST /bounce`). 한 사람에 최고 기록 한 줄(별명·점수·골·버틴 초·시각)만 Durable Object 저장소 하나(`bounce:board`, AI 하루 횟수와 같은 `Counter` 종류)에 두고, 사람은 Firebase 사용자 번호를 SHA-256으로 바꾼 값으로만 가리킵니다. 별명은 한글·영어·숫자·빈칸·`_`·`-` 12자까지, 점수는 버틴 시간으로 낼 수 있는 만큼만 받습니다. 주인 계정(`OWNER_EMAILS`)은 줄을 지울 수 있습니다. AI 도우미 설정(`OPEN_TO`, 하루 횟수)과는 상관없습니다.

## Cloudflare 설정 (Workers Builds)
- Root directory: `/worker`, Build command: 비움, Deploy command: `npx wrangler deploy`
- 값(`wrangler.toml`의 `[vars]`): `DAILY_LIMIT`(하루 횟수), `OPEN_TO`(`owner` = 주인 계정만, `all` = 모두), `PHOTO_TO`(사진 보내기. `owner` = 주인 계정만, `all` = AI를 쓸 수 있는 모두), `MODEL`, `MAX_TOKENS`(답의 최대 길이), `THINKING`(`off` = 모델이 답하기 전에 속으로 생각하지 않게. 켜 두면 생각에 답 길이를 다 써서 답이 잘리거나 빈 채로 온다), `ALLOWED_ORIGINS`
- 기록: 모델이 오류를 내면 서버가 까닭을 남깁니다(사용자의 말은 남기지 않음). Cloudflare 화면의 Worker > Logs에서 볼 수 있습니다 (`[observability]`)
- 비밀 값: `OWNER_EMAILS`는 저장소에 적지 않고 Worker의 Settings > Variables and Secrets에 Secret으로 넣습니다 (Builds 안의 빌드용 변수가 아님)

## 테스트
저장소 루트에서 `node --test tests/worker.test.mjs`
