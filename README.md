# Tracelium — Recovery Demo Prototype

Prototype React cho khách hàng **tự thao tác** cơ chế zero-knowledge recovery:
Shamir Secret Sharing, break-glass quorum, key reset và audit log.

## Chạy

```bash
npm install
npm run dev      # http://localhost:5173
```

Không cần backend — toàn bộ chạy trong browser. Mọi key material được tạo thật
bằng **Web Crypto API** (không phải fake string):

- User key pair: RSA-OAEP 2048
- Workspace Key: AES-256-GCM, wrap riêng cho từng user (key envelope)
- Recovery Secret: 32 bytes, chia bằng thư viện `shamir-secret-sharing` (GF(256))
- Recovery envelope: AES-GCM(WorkspaceKey, key = RecoverySecret)
- Khi đủ quorum: shares được combine thật, envelope được decrypt thật,
  Workspace Key được re-wrap thật cho key mới — sau đó secret bị wipe khỏi memory.

Key thật chỉ sống trong `src/services/vault.ts` (in-memory). UI state (Zustand)
chỉ chứa fingerprint và version label — không bao giờ chứa key/share/secret.

## Hai demo chính (Dashboard hoặc Demo Mode)

| Demo | Nội dung | Log chứng minh |
| --- | --- | --- |
| **Demo 1 — Tạo, phân mảnh & lưu Recovery Code** | Workspace mới chưa có recovery code → trang **Recovery Setup** hiện modal cảnh báo bắt buộc (không tắt được) → wizard 4 bước: chọn quorum → add người có quyền → tạo & split → done | Secret 32 bytes tạo client-side → Shamir split 3 shares (fingerprint + holder) → shares lưu về custody từng người → seal envelope → wipe plaintext |
| **Demo 2 — Mất tài khoản: request → approve → tổng hợp → mã hóa lại** | Alice mất credentials → request → đổi role từng approver duyệt → Begin Recovery | Approver chỉ thấy metadata; mỗi approval được ghi lại (signed record + share authorized) và tổng hợp 1/2 → 2/2; combine shares → fingerprint khớp setup → re-wrap (mã hóa lại) → destroy temp secret |

Trang **Demo Mode** có script từng bước cho presenter, kèm Other tools: đổi
scenario single-owner, variant user thường (Owner approve), Recovery Test,
Reset Demo.

## Cấu trúc

```
src/
├── app/App.tsx              # layout + router + role switcher
├── pages/                   # Dashboard, Members, Policy, Requests, Detail, Audit, Demo
├── components/              # QuorumProgress, RecoveryTimeline, Pills, Banners…
├── services/
│   ├── crypto.service.ts    # keygen, fingerprint (Web Crypto)
│   ├── shamir.service.ts    # split/combine (shamir-secret-sharing)
│   ├── envelope.service.ts  # wrap/unwrap + recovery envelope
│   └── vault.ts             # in-memory key vault (không bao giờ vào UI state)
├── store/store.ts           # Zustand: state machine, quorum, audit, scenarios
└── models/types.ts          # User, RecoveryPolicy, RecoveryRequest, AuditEvent…
```

Request state machine: `PENDING_APPROVAL → QUORUM_REACHED → RECOVERY_IN_PROGRESS
→ COMPLETED` (+ `REJECTED / FAILED / EXPIRED / CANCELLED`). Mỗi lần đổi state
sinh audit event; audit không bao giờ chứa share value, secret, private key hay
Recovery Code.

## Key Architecture (sidebar)

Màn hình trả lời trực tiếp hai câu hỏi cốt lõi của technical solution:

- **Key lưu ở đâu** — "Live trust boundaries": 3 cột custody đọc từ vault thật
  (User trusted clients / Tracelium server zero-knowledge / Recovery party
  custody) + bảng Key inventory (9 loại key: tạo khi nào, tạo ở đâu, lưu ở đâu,
  server thấy gì).
- **Recovery key tạo khi nào** — timeline 5 mốc: account creation → workspace
  creation → **Recovery Setup generation** (Recovery Secret + shares + recovery
  envelope sinh ra tại đây, không phải từ ngày đầu) → key reset → break-glass.

## Crypto Trace console

Nút **`</>` Crypto Trace** trên topbar (hoặc "View Crypto Trace" trong Recovery
Policy) mở console log trực tiếp mọi thao tác crypto thật khi chúng diễn ra:

- `KEYGEN` — tạo RSA keypair / AES Workspace Key / Recovery Secret (kèm SHA-256 commitment)
- `SHAMIR` — split/combine shares (hash từng share, tham số threshold)
- `WRAP` — wrap Workspace Key thành envelope (preview ciphertext)
- `ENVELOPE` — seal/open recovery envelope (IV, auth tag verified)
- `VERIFY` — **bằng chứng**: hash secret reconstruct == hash lúc setup; hash
  Workspace Key recover == hash lúc tạo (chứng minh không cần re-encrypt data);
  tamper test — share bị sửa 1 byte bị AES-GCM từ chối
- `WIPE` — thời điểm secret bị xóa khỏi memory

Console không bao giờ in giá trị secret/share/private key — chỉ SHA-256
commitment, đủ để chứng minh tính đúng mà không phá zero-knowledge.

## Ranh giới tin cậy được chứng minh trong demo

- Owner approve reset **không** lấy lại được private key cũ — chỉ tạo identity mới.
- Reset key chỉ re-wrap envelope, **không** mã hóa lại workspace data.
- Recovery Secret chỉ tồn tại tạm trong memory khi đủ quorum, có countdown, bị
  wipe ngay sau khi re-wrap xong.
- Tracelium System Admin không có workspace envelope và không bao giờ tự đạt
  quorum một mình (UI chặn + logic chặn).
- 1-of-1 / secondary email của chính owner đều có cảnh báo trade-off rõ ràng.

## Kiểm thử

- `npm run typecheck` — typecheck TypeScript.
- `npm run test:logic` — end-to-end logic: chạy store thật (crypto thật) qua cả
  3 scenario, ~50 assertions, không cần browser.
- `npm run test:ui` — end-to-end UI: điều khiển Chrome headless click qua toàn bộ
  demo flow, fail nếu có console error; screenshots lưu vào `test-results/`.
  Yêu cầu dev server đang chạy (`npm run dev`) và Google Chrome
  (đổi đường dẫn bằng env `CHROME_PATH` nếu cần).

## Ngoài phạm vi (đúng theo plan)

Không mã hóa file thật, không gửi email, không passkey production (nút
"Verify with Passkey" là mô phỏng), không Nitro Enclave, không auth thật.
