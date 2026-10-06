#!/usr/bin/env bash
set -euo pipefail
veya_test_dir=$(mktemp -d)
veya_media_pid=''
cleanup() {
  if [ -n "$veya_media_pid" ]; then kill "$veya_media_pid" 2>/dev/null || true; fi
  rm -rf "$veya_test_dir"
}
trap cleanup EXIT
curl -fsSL --retry 3 --max-time 90 https://github.com/livekit/livekit/releases/download/v1.13.8/livekit_1.13.8_linux_amd64.tar.gz -o "$veya_test_dir/livekit.tar.gz"
cd "$veya_test_dir"
echo '059f6de65da11a57400e4646027da705d592ce42acb48c08570a397df446f869  livekit.tar.gz' | sha256sum -c -
tar --no-same-owner -xzf livekit.tar.gz
cat > local.yaml <<'YAML'
port: 7880
bind_addresses: [127.0.0.1]
rtc:
  node_ip: 127.0.0.1
  use_external_ip: false
  enable_loopback_candidate: true
  tcp_port: 7881
  udp_port: 7882
keys:
  devkey: secret
YAML
./livekit-server --dev --config local.yaml > media.log 2>&1 &
veya_media_pid=$!
cd - >/dev/null
for attempt in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:7880 >/dev/null; then break; fi
  if ! kill -0 "$veya_media_pid" 2>/dev/null; then cat "$veya_test_dir/media.log"; exit 1; fi
  sleep 1
done
export LIVEKIT_URL=ws://127.0.0.1:7880
export LIVEKIT_API_KEY=devkey
export LIVEKIT_API_SECRET=secret
node scripts/browser-smoke.mjs || { cat "$veya_test_dir/media.log"; exit 1; }
