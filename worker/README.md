# 스터디 프로모션 AI 도우미 서버 (Cloudflare Worker)

앱의 AI 도우미(js/ai.js)가 부르는 서버입니다. 로그인 확인 → 하루 횟수 세기 → Workers AI 모델에 묻기 → 답을 조금씩 앱으로 보냅니다.

## Cloudflare 설정 (Workers Builds)
- Root directory: `/worker`, Build command: 비움, Deploy command: `npx wrangler deploy`
- 값(`wrangler.toml`의 `[vars]`): `DAILY_LIMIT`(하루 횟수), `OPEN_TO`(`owner` = 주인 계정만, `all` = 모두), `MODEL`, `MAX_TOKENS`(답의 최대 길이), `THINKING`(`off` = 모델이 답하기 전에 속으로 생각하지 않게. 켜 두면 생각에 답 길이를 다 써서 답이 잘리거나 빈 채로 온다), `ALLOWED_ORIGINS`
- 기록: 모델이 오류를 내면 서버가 까닭을 남깁니다(사용자의 말은 남기지 않음). Cloudflare 화면의 Worker > Logs에서 볼 수 있습니다 (`[observability]`)
- 비밀 값: `OWNER_EMAILS`는 저장소에 적지 않고 Worker의 Settings > Variables and Secrets에 Secret으로 넣습니다 (Builds 안의 빌드용 변수가 아님)

## 테스트
저장소 루트에서 `node --test tests/worker.test.mjs`
