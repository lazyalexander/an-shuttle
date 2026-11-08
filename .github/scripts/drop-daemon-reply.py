#!/usr/bin/env python3
"""Explicit acceptance launcher: lose only an acknowledged submit reply.

Use as AN_AGENT_HOST_BIN with AN_AGENT_TEST_REAL_HOST set to the selected host.
The real service still admits and runs the task. All other host calls exec the
original binary. This is test fault injection, never a production retry route.
"""
import json
import os
from pathlib import Path
import subprocess
import sys

real = os.environ['AN_AGENT_TEST_REAL_HOST']
args = sys.argv[1:]
if len(args) == 4 and args[:2] == ['daemon', 'request']:
    request = json.loads(Path(args[3]).read_text())
    if request.get('op') == 'submit' and request.get('approve'):
        result = subprocess.run([real, *args], capture_output=True)
        if result.returncode == 0:
            print('Injected loss after durable native submission; inspect original work.', file=sys.stderr)
            raise SystemExit(86)
        sys.stdout.buffer.write(result.stdout)
        sys.stderr.buffer.write(result.stderr)
        raise SystemExit(result.returncode)
os.execv(real, [real, *args])
