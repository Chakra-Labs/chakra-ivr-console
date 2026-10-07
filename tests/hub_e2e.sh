#!/usr/bin/env bash
# The hub against a real Postgres ($DATABASE_URL) that license_server_e2e.py has
# set up (licences 1 Acme: Chakra Voice + one Gemini Live line, 2 Beta: Gemini
# Live "Leda", 3 Gamma). Lints, type-checks, builds and starts the hub, then
# checks over HTTP: the voice API, what a company account may and may not do,
# and the licence list's fields. Needs Node 20 and curl. CI runs it (deploy.yml).
# With KEEP=1 the hub stays up afterwards on :3311 (test admin sign-in below).
set -u
cd "$(dirname "$0")/../chakra-license-hub"
corepack enable >/dev/null 2>&1; corepack prepare pnpm@10 --activate >/dev/null 2>&1
pnpm install --frozen-lockfile >/dev/null 2>&1 || pnpm install >/dev/null 2>&1
pnpm lint || { echo "LINT FAILED"; exit 1; }
# The build type-checks, and writes the route types tsc needs (.next/types).
pnpm build >/tmp/build.log 2>&1 || { echo "BUILD FAILED"; tail -40 /tmp/build.log; exit 1; }
pnpm exec tsc --noEmit || { echo "TYPE CHECK FAILED"; exit 1; }
echo "build ok"

ADMIN_HASH=$(node -e '
const c=require("crypto");const s=c.randomBytes(16);
const k=c.scryptSync("preview-admin-pass",s,32,{N:16384,r:8,p:1});
console.log(["scrypt",16384,8,1,s.toString("base64url"),k.toString("base64url")].join(":"))')
export ADMIN_USERS="preview-admin@chakralabs.lk=$ADMIN_HASH"
export SESSION_SECRET="test-session-secret-0123456789abcdef0123456789"
PORT=3311 pnpm start >/tmp/start.log 2>&1 &
for i in $(seq 60); do curl -s -o /dev/null http://127.0.0.1:3311/login && break; sleep 1; done

U=http://127.0.0.1:3311
pass=0; fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1 (expected $2, got $3)"; fail=$((fail+1)); fi
}
code() { curl -s -o /tmp/body -w "%{http_code}" "$@"; }
js() { node -pe "const d=JSON.parse(require('fs').readFileSync(0)); $1"; }
J='-H Content-Type:application/json -H Origin:http://127.0.0.1:3311'
O='-H Origin:http://127.0.0.1:3311'

# Test clips: 16 kHz mono PCM WAVs of a given length.
wav() { node -e '
const [sec,out]=[Number(process.argv[1]),process.argv[2]];const sr=16000,n=Math.round(sec*sr);
const b=Buffer.alloc(44+2*n);b.write("RIFF",0);b.writeUInt32LE(36+2*n,4);b.write("WAVEfmt ",8);b.writeUInt32LE(16,16);
b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(sr,24);b.writeUInt32LE(2*sr,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);
b.write("data",36);b.writeUInt32LE(2*n,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(8000*Math.sin(i*0.05)),44+2*i);
require("fs").writeFileSync(out,b)' "$1" "$2"; }
wav 7 /tmp/ok.wav; wav 2 /tmp/short.wav; wav 12 /tmp/long.wav; wav 8 /tmp/ok2.wav
echo "this is not audio at all, just some text pretending to be a wav file" > /tmp/fake.wav
SI="ආයුබෝවන්, ඔබට සහාය වෙන්නේ කෙසේද?"

check "no session -> 401 (voice)" 401 "$(code "$U/api/voice?license=1")"
check "admin login" 200 "$(code -c /tmp/admin $J -X POST $U/api/auth/login -d '{"email":"preview-admin@chakralabs.lk","password":"preview-admin-pass"}')"
check "admin sees 3 licences" 3 "$(curl -s -b /tmp/admin $U/api/licenses | js 'd.length')"
check "licence 1: both kinds of voice" "clone,preset" "$(curl -s -b /tmp/admin $U/api/licenses | js 'd.find(l=>l.id===1).voice_modes.join()')"
check "licence 2: preset only, Leda" "preset Leda" "$(curl -s -b /tmp/admin $U/api/licenses | js 'const l=d.find(l=>l.id===2); l.voice_modes.join()+" "+l.gemini_voice')"
check "licence 3: an unknown stored voice reads as none" "null" "$(curl -s -b /tmp/admin $U/api/licenses | js 'String(d.find(l=>l.id===3).gemini_voice)')"
check "licence 1: 3 calls this month" 3 "$(curl -s -b /tmp/admin $U/api/licenses | js 'd.find(l=>l.id===1).month_calls')"
check "licence 1: no custom voice yet" false "$(curl -s -b /tmp/admin $U/api/licenses | js 'd.find(l=>l.id===1).has_custom_voice')"

check "voice state" "clone,preset||null" "$(curl -s -b /tmp/admin "$U/api/voice?license=1" | js 'd.modes.join()+"|"+d.preset+"|"+d.custom')"
check "voice needs a licence (admin)" 400 "$(code -b /tmp/admin "$U/api/voice")"
check "unknown licence" 404 "$(code -b /tmp/admin "$U/api/voice?license=999")"
check "set preset" 200 "$(code -b /tmp/admin $J -X PUT $U/api/voice -d '{"licenseId":1,"preset":"Orus"}')"
check "preset saved" Orus "$(curl -s -b /tmp/admin "$U/api/voice?license=1" | js 'd.preset')"
check "a voice not on the list is refused" 400 "$(code -b /tmp/admin $J -X PUT $U/api/voice -d '{"licenseId":1,"preset":"Puck"}')"
check "clear preset" 200 "$(code -b /tmp/admin $J -X PUT $U/api/voice -d '{"licenseId":1,"preset":""}')"
check "preset cleared" "" "$(curl -s -b /tmp/admin "$U/api/voice?license=1" | js 'd.preset')"

check "upload a 7 s clip" 200 "$(code -b /tmp/admin $O -X POST $U/api/voice -F license=1 -F file=@/tmp/ok.wav -F "transcript=$SI")"
check "clip stored" "pending 7.0 ok.wav" "$(curl -s -b /tmp/admin "$U/api/voice?license=1" | js 'd.custom.status+" "+d.custom.seconds.toFixed(1)+" "+d.custom.file_name')"
check "voice id is the licence's" "v1-" "$(curl -s -b /tmp/admin "$U/api/voice?license=1" | js 'd.custom.voice_id.slice(0,3)')"
V1=$(curl -s -b /tmp/admin "$U/api/voice?license=1" | js 'd.custom.voice_id')
check "transcript kept" "$SI" "$(curl -s -b /tmp/admin "$U/api/voice?license=1" | js 'd.custom.transcript')"
check "clip can be played back" "200 audio/wav $(stat -c %s /tmp/ok.wav)" "$(curl -s -b /tmp/admin -o /tmp/back.wav -w '%{http_code} %{content_type} %{size_download}' "$U/api/voice?license=1&audio=1")"
check "played-back clip is the upload" same "$(cmp -s /tmp/ok.wav /tmp/back.wav && echo same || echo differs)"
check "licence list shows the custom voice" true "$(curl -s -b /tmp/admin $U/api/licenses | js 'd.find(l=>l.id===1).has_custom_voice')"
check "2 s clip refused" 400 "$(code -b /tmp/admin $O -X POST $U/api/voice -F license=1 -F file=@/tmp/short.wav -F "transcript=$SI")"
check "…with a reason" "true" "$(js 'd.error.includes("2.0 seconds")' < /tmp/body)"
check "12 s clip refused" 400 "$(code -b /tmp/admin $O -X POST $U/api/voice -F license=1 -F file=@/tmp/long.wav -F "transcript=$SI")"
check "not a WAV refused" 400 "$(code -b /tmp/admin $O -X POST $U/api/voice -F license=1 -F file=@/tmp/fake.wav -F "transcript=$SI")"
check "no transcript refused" 400 "$(code -b /tmp/admin $O -X POST $U/api/voice -F license=1 -F file=@/tmp/ok.wav -F "transcript=  ")"
check "no file refused" 400 "$(code -b /tmp/admin $O -X POST $U/api/voice -F license=1 -F "transcript=$SI")"
check "refused uploads left the clip alone" "$V1" "$(curl -s -b /tmp/admin "$U/api/voice?license=1" | js 'd.custom.voice_id')"
check "a new clip gets a new id" different "$(code -b /tmp/admin $O -X POST $U/api/voice -F license=1 -F file=@/tmp/ok2.wav -F "transcript=$SI" >/dev/null; [ "$(curl -s -b /tmp/admin "$U/api/voice?license=1" | js 'd.custom.voice_id')" != "$V1" ] && echo different || echo same)"

# A company account: its own voice, nothing else.
check "create company sign-in" 200 "$(code -b /tmp/admin $J -X PUT $U/api/console-users -d '{"licenseId":1,"email":"ops@acme.lk","password":"company-pass-1"}')"
check "sign-in list (admin)" "1 ops@acme.lk" "$(curl -s -b /tmp/admin $U/api/console-users | js 'd.length+" "+d[0].email')"
check "company login" 200 "$(code -c /tmp/co $J -X POST $U/api/auth/login -d '{"email":"ops@acme.lk","password":"company-pass-1"}')"
check "company cannot list sign-ins" 403 "$(code -b /tmp/co $U/api/console-users)"
check "company licence: no pipelines, but voice kinds" "0 0 clone,preset" "$(curl -s -b /tmp/co $U/api/licenses | js 'd[0].pipelines.length+" "+Object.keys(d[0].agent_pipelines).length+" "+d[0].voice_modes.join()')"
check "company reads its voice (no id needed)" "clone,preset" "$(curl -s -b /tmp/co $U/api/voice | js 'd.modes.join()')"
check "company cannot read another's voice" 403 "$(code -b /tmp/co "$U/api/voice?license=2")"
check "company cannot play another's clip" 403 "$(code -b /tmp/co "$U/api/voice?license=2&audio=1")"
check "company sets its preset" 200 "$(code -b /tmp/co $J -X PUT $U/api/voice -d '{"preset":"Despina"}')"
check "company preset saved" Despina "$(curl -s -b /tmp/admin $U/api/licenses | js 'd.find(l=>l.id===1).gemini_voice')"
check "company cannot set another's preset" 403 "$(code -b /tmp/co $J -X PUT $U/api/voice -d '{"licenseId":2,"preset":"Orus"}')"
check "licence 2 untouched" Leda "$(curl -s -b /tmp/admin $U/api/licenses | js 'd.find(l=>l.id===2).gemini_voice')"
check "company uploads its clip" 200 "$(code -b /tmp/co $O -X POST $U/api/voice -F file=@/tmp/ok.wav -F "transcript=$SI")"
check "…recorded as uploaded by the company" ops@acme.lk "$(curl -s -b /tmp/co $U/api/voice | js 'd.custom.updated_by')"
check "company cannot upload for another" 403 "$(code -b /tmp/co $O -X POST $U/api/voice -F license=2 -F file=@/tmp/ok.wav -F "transcript=$SI")"
check "company cannot remove another's" 403 "$(code -b /tmp/co $J -X DELETE $U/api/voice -d '{"licenseId":2}')"
check "company still cannot change its pipeline" 403 "$(code -b /tmp/co $J -X PUT $U/api/licenses -d '{"id":1,"action":"pipelines","pipelines":["gemini_live"]}')"
check "company removes its clip" 200 "$(code -b /tmp/co $J -X DELETE $U/api/voice -d '{}')"
check "clip gone" null "$(curl -s -b /tmp/co $U/api/voice | js 'String(d.custom)')"
check "no clip to play" 404 "$(code -b /tmp/co "$U/api/voice?audio=1")"

# Pipelines decide the voice kinds; deleting a licence removes its clip.
check "pipeline change (admin)" 200 "$(code -b /tmp/admin $J -X PUT $U/api/licenses -d '{"id":1,"action":"pipelines","pipelines":["chakra"],"agentPipelines":{}}')"
check "…reply carries the new voice kinds" clone "$(js 'd.voice_modes.join()' < /tmp/body)"
check "package change to the special offer" 200 "$(code -b /tmp/admin $J -X PUT $U/api/licenses -d '{"id":1,"action":"package","packageName":"Govimithuru Special Starter"}')"
code -b /tmp/admin $O -X POST $U/api/voice -F license=3 -F file=@/tmp/ok.wav -F "transcript=$SI" >/dev/null
check "delete a licence with a clip" 200 "$(code -b /tmp/admin $J -X DELETE $U/api/licenses -d '{"id":3}')"
check "its clip went with it" 404 "$(code -b /tmp/admin "$U/api/voice?license=3")"
check "app shell renders" 200 "$(code -b /tmp/admin $U/)"
echo "RESULT: $pass passed, $fail failed"
[ "${KEEP:-}" = 1 ] && { echo "PREVIEW READY"; wait; }
[ "$fail" = 0 ]
