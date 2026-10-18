#!/usr/bin/env python3
"""Replay the blank-thread bug against the stand-in desktop, recording the result.

Start live-desktop.ts with --seed --scroll-stress --control /tmp/scroll-control.json,
pair a simulator, open "A long thread to scroll" and scroll to its end. Then run:
  python3 ios/scripts/thread-scroll-test.py <simulator-udid> /tmp/scroll-control.json

Requires axe and ffmpeg. Uses sample messages only. Videos stay in a temp folder.
The phone initially loads 100 of the fixture's 600 messages; no history loading
is needed to reproduce. Sends here simulate steers arriving from the computer.
"""

import argparse
import collections
import json
from pathlib import Path
import signal
import subprocess
import tempfile
import time


def run(*args):
    return subprocess.check_output(args, text=True)


def replay(simulator, control, width, height):
    def send(body):
        control.write_text(json.dumps({
            "do": "send", "chat": "A long thread", "body": body, "steer": True,
        }))

    send("busy scroll test one")
    time.sleep(15)
    send("busy scroll test two")
    time.sleep(2)
    run("axe", "swipe", "--start-x", str(width / 2), "--end-x", str(width / 2),
        "--start-y", str(height * .25), "--end-y", str(height * .79),
        "--duration", "0.2", "--udid", simulator)
    time.sleep(6)
    send("busy scroll test three")
    time.sleep(16)
    send("short scroll test finish")
    time.sleep(8)


def blank_spans(video):
    info = json.loads(run("ffprobe", "-v", "error", "-select_streams", "v:0",
                          "-show_entries", "stream=width,height", "-of", "json", str(video)))["streams"][0]
    width, height = info["width"], info["height"]
    # The thread body, excluding the bars, composer, usage bubble and scroll indicator.
    crop = f"crop={int(width * .9)}:{int(height * .56)}:{int(width * .05)}:{int(height * .15)}"
    pixels = subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", str(video), "-vf",
        crop + ",fps=4,scale=100:150,format=gray", "-f", "rawvideo", "-",
    ])
    spans = []
    for i in range(len(pixels) // 15000):
        frame = pixels[i * 15000:(i + 1) * 15000]
        background = collections.Counter(frame).most_common(1)[0][0]
        ink = sum(abs(p - background) > 20 for p in frame) / len(frame)
        if ink < .001:
            if spans and i == spans[-1][1] + 1:
                spans[-1][1] = i
            else:
                spans.append([i, i])
    return [(a / 4, (b + 1) / 4) for a, b in spans if b - a >= 2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("simulator")
    parser.add_argument("control", type=Path)
    args = parser.parse_args()
    if not args.control.is_file():
        parser.error("Start the stand-in desktop with --control pointing to this file first.")
    ui = run("axe", "describe-ui", "--udid", args.simulator)
    if "The very last line of the thread." not in ui:
        parser.error('Open the fresh "A long thread to scroll" fixture and scroll to its end first.')
    frame = json.loads(ui)[0]["frame"]
    folder = Path(tempfile.mkdtemp(prefix="relay-thread-scroll-"))
    video = folder / "replay.mov"
    with (folder / "recording.log").open("w") as log:
        recorder = subprocess.Popen([
            "xcrun", "simctl", "io", args.simulator, "recordVideo", "--codec=h264", str(video),
        ], stdout=log, stderr=log)
        try:
            # simctl's recorder needs a little lead-in before the first action.
            time.sleep(2)
            if recorder.poll() is not None:
                raise RuntimeError(f"Recording failed; see {folder / 'recording.log'}")
            print("Replaying growing traces, a scroll and three steers (about one minute).", flush=True)
            replay(args.simulator, args.control, frame["width"], frame["height"])
        finally:
            if recorder.poll() is None:
                recorder.send_signal(signal.SIGINT)
                try:
                    recorder.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    recorder.kill()
                    recorder.wait()
                    raise RuntimeError(f"Recording did not finish; see {folder / 'recording.log'}")
    spans = blank_spans(video)
    print(f"Recording: {video}", flush=True)
    if spans:
        raise SystemExit(f"FAIL: empty thread body for at least 0.75s at {spans}")
    print("PASS: no sustained empty thread body. Inspect the recording for movement and anchoring.")


if __name__ == "__main__":
    main()
