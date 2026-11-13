"""
Obsidian 滚轮唤醒助手 v3（笔/鼠标自动区分）

作用
----
切标签后，把光标搬进当前内容区中心，让 TourBox 旋钮（= 鼠标滚轮）能找到目标。
滚轮事件只发给「光标下的窗口」，光标停在侧栏/边缘时旋钮就是死的。

笔/鼠标区分
----------
用 Windows 原始输入（Raw Input）监听全局输入设备：
  - 数位笔通常以 HID Digitizer（usage page 0x0D）上报 → 记为「笔活动」
  - 鼠标以 usage page 0x01 上报 → 记为「鼠标活动」
规则：只有在「笔活动」之后的一段时间内（默认 5 分钟）才搬光标；
      否则跳过，保持原样（鼠标用户自己动一下就好，不需要搬）。

接口
----
GET /point?fx=..&fy=..&fw=..&fh=..   目标中心与尺寸（窗口内比例）
GET /jiggle                          仅抖动
GET /ping                            存活
GET /devices                         列出已观察到的输入设备
GET /mode?force=pen|mouse|auto       手动覆盖判定（auto = 回到自动）

热键 Ctrl+Alt+M 兜底抖动。
"""

import ctypes
import sys
import threading
import time
from ctypes import wintypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import win32api
import win32con
import win32gui
import win32process

PORT = 37250
PEN_WINDOW_SEC = 300.0
OBSIDIAN_EXE = "obsidian.exe"

pen_last_ts = 0.0
last_input_was_pen = False
forced_mode = "pen"  # pen | mouse  ← 手动开关控制
seen_devices = {}  # name -> info dict
last_seen = {}  # name -> 上次记录时间（节流用）

# ---------------- 日志 ----------------

def log(msg: str) -> None:
    try:
        with open("helper.log", "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")
    except Exception:
        pass


# ---------------- 原始输入（笔/鼠标区分） ----------------

user32 = ctypes.WinDLL("user32", use_last_error=True)

WM_INPUT = 0x00FF
RID_INPUT = 0x10000003
RIDI_DEVICENAME = 0x20000007
RIDI_DEVICEINFO = 0x2000000B
RIM_TYPEMOUSE = 0
RIM_TYPEKEYBOARD = 1
RIM_TYPEHID = 2
RIDEV_INPUTSINK = 0x00000100


class RAWINPUTDEVICE(ctypes.Structure):
    _fields_ = [
        ("usUsagePage", wintypes.USHORT),
        ("usUsage", wintypes.USHORT),
        ("dwFlags", wintypes.DWORD),
        ("hwndTarget", wintypes.HWND),
    ]


class RAWINPUTHEADER(ctypes.Structure):
    _fields_ = [
        ("dwType", wintypes.DWORD),
        ("dwSize", wintypes.DWORD),
        ("hDevice", wintypes.HANDLE),
        ("wParam", wintypes.WPARAM),
    ]


class RID_DEVICE_INFO_HID(ctypes.Structure):
    _fields_ = [
        ("dwVendorId", wintypes.DWORD),
        ("dwProductId", wintypes.DWORD),
        ("dwVersionNumber", wintypes.DWORD),
        ("usUsagePage", wintypes.USHORT),
        ("usUsage", wintypes.USHORT),
    ]


class RID_DEVICE_INFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("dwType", wintypes.DWORD),
        ("hid", RID_DEVICE_INFO_HID),
    ]


def register_raw_input(hwnd):
    devices = [
        RAWINPUTDEVICE(0x01, 0x02, RIDEV_INPUTSINK, hwnd),  # 鼠标
        RAWINPUTDEVICE(0x01, 0x06, RIDEV_INPUTSINK, hwnd),  # 键盘
        RAWINPUTDEVICE(0x0D, 0x02, RIDEV_INPUTSINK, hwnd),  # 笔/数字化仪
        RAWINPUTDEVICE(0x0D, 0x04, RIDEV_INPUTSINK, hwnd),  # 触摸
    ]
    arr = (RAWINPUTDEVICE * len(devices))(*devices)
    ok = user32.RegisterRawInputDevices(arr, len(devices), ctypes.sizeof(RAWINPUTDEVICE))
    log(f"RegisterRawInputDevices -> {bool(ok)}")
    return bool(ok)


def device_name(hDevice):
    size = wintypes.UINT(0)
    user32.GetRawInputDeviceInfoW(hDevice, RIDI_DEVICENAME, None, ctypes.byref(size))
    if size.value == 0:
        return ""
    buf = ctypes.create_unicode_buffer(size.value)
    user32.GetRawInputDeviceInfoW(hDevice, RIDI_DEVICENAME, buf, ctypes.byref(size))
    return buf.value


def device_info(hDevice):
    info = RID_DEVICE_INFO()
    info.cbSize = ctypes.sizeof(RID_DEVICE_INFO)
    size = wintypes.UINT(ctypes.sizeof(RID_DEVICE_INFO))
    ok = user32.GetRawInputDeviceInfoW(
        hDevice, RIDI_DEVICEINFO, ctypes.byref(info), ctypes.byref(size)
    )
    return info if ok else None


def on_raw_input(lparam):
    global pen_last_ts, last_input_was_pen
    try:
        size = wintypes.UINT(0)
        user32.GetRawInputData(
            lparam, RID_INPUT, None, ctypes.byref(size), ctypes.sizeof(RAWINPUTHEADER)
        )
        if size.value == 0:
            return
        buf = ctypes.create_string_buffer(size.value)
        if user32.GetRawInputData(
            lparam, RID_INPUT, buf, ctypes.byref(size), ctypes.sizeof(RAWINPUTHEADER)
        ) != size.value:
            return
        header = ctypes.cast(buf, ctypes.POINTER(RAWINPUTHEADER)).contents
        name = device_name(header.hDevice)
        info = device_info(header.hDevice)

        usage_page = info.hid.usUsagePage if info and info.dwType == RIM_TYPEHID else 0
        is_pen = usage_page == 0x0D

        key = name or f"hdevice:{header.hDevice}"
        now = time.time()
        last = last_seen.get(key, 0)
        if now - last > 0.4:
            last_seen[key] = now
            log(f"输入: type={info.dwType if info else '?'} usagePage=0x{usage_page:02X} pen={is_pen} dev={name[-60:]}")
        if key not in seen_devices:
            seen_devices[key] = {
                "dwType": info.dwType if info else -1,
                "usagePage": usage_page,
                "usage": info.hid.usUsage if info and info.dwType == RIM_TYPEHID else 0,
                "vendor": info.hid.dwVendorId if info and info.dwType == RIM_TYPEHID else 0,
                "product": info.hid.dwProductId if info and info.dwType == RIM_TYPEHID else 0,
                "isPen": is_pen,
            }
            log(f"新设备 type={seen_devices[key]['dwType']} usagePage=0x{usage_page:02X} pen={is_pen} name={name[:90]}")

        if is_pen:
            pen_last_ts = time.time()
    except Exception as e:
        log(f"raw input 解析异常: {e}")


def create_message_window():
    wc = win32gui.WNDCLASS()
    wc.lpszClassName = "ObsidianWheelHelperWnd"
    wc.hInstance = win32api.GetModuleHandle(None)

    def wndproc(hwnd, msg, wparam, lparam):
        if msg == WM_INPUT:
            on_raw_input(lparam)
        return win32gui.DefWindowProc(hwnd, msg, wparam, lparam)

    wc.lpfnWndProc = wndproc
    try:
        win32gui.RegisterClass(wc)
    except Exception:
        pass
    hwnd = win32gui.CreateWindow(
        wc.lpszClassName, "wheel-helper", 0, 0, 0, 0, 0, 0, 0, wc.hInstance, None
    )
    return hwnd


# ---------------- 光标与窗口 ----------------

def obsidian_pids():
    pids = []
    for pid in win32process.EnumProcesses():
        if pid == 0:
            continue
        try:
            h = win32api.OpenProcess(
                win32con.PROCESS_QUERY_LIMITED_INFORMATION, False, pid
            )
        except Exception:
            continue
        try:
            if win32process.GetModuleFileNameEx(h, 0).lower().endswith(OBSIDIAN_EXE):
                pids.append(pid)
        except Exception:
            pass
        finally:
            try:
                win32api.CloseHandle(h)
            except Exception:
                pass
    return pids


def find_obsidian_window():
    pids = set(obsidian_pids())
    if not pids:
        return None
    best, best_area = None, 0

    def cb(hwnd, _):
        nonlocal best, best_area
        try:
            if not win32gui.IsWindowVisible(hwnd):
                return True
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            if pid not in pids:
                return True
            l, t, r, b = win32gui.GetWindowRect(hwnd)
            area = (r - l) * (b - t)
            if area > best_area:
                best, best_area = hwnd, area
        except Exception:
            pass
        return True

    win32gui.EnumWindows(cb, None)
    return best


def client_rect_screen(hwnd):
    cl, ct, cr, cb = win32gui.GetClientRect(hwnd)
    sl, st = win32gui.ClientToScreen(hwnd, (cl, ct))
    sr, sb = win32gui.ClientToScreen(hwnd, (cr, cb))
    return sl, st, sr - sl, sb - st


def jiggle():
    x, y = win32api.GetCursorPos()
    win32api.SetCursorPos((x + 2, y))
    time.sleep(0.03)
    win32api.SetCursorPos((x, y))


def pen_mode_active():
    if forced_mode == "pen":
        return True
    if forced_mode == "mouse":
        return False
    return (time.time() - pen_last_ts) <= PEN_WINDOW_SEC


def goto_fraction(fx, fy, fw=0.0, fh=0.0):
    if not pen_mode_active():
        return "skipped-mouse-mode"

    hwnd = find_obsidian_window()
    if not hwnd:
        return "no-obsidian-window"
    l, t, w, h = client_rect_screen(hwnd)
    if w <= 0 or h <= 0:
        return "bad-rect"

    tx = int(l + w * fx)
    ty = int(t + h * fy)
    cx, cy = win32api.GetCursorPos()

    if fw > 0 and fh > 0:
        rl = l + w * (fx - fw / 2)
        rt = t + h * (fy - fh / 2)
        rr = l + w * (fx + fw / 2)
        rb = t + h * (fy + fh / 2)
        inside = (rl <= cx <= rr) and (rt <= cy <= rb)
    else:
        inside = abs(cx - tx) <= 200 and abs(cy - ty) <= 200

    try:
        # 只要目标点不同就移动（原来"已在区域内就跳过"会让后续切标签不再回中）
        moved = False
        if abs(cx - tx) > 2 or abs(cy - ty) > 2:
            win32api.SetCursorPos((tx, ty))
            log(f"光标移入 ({cx},{cy}) -> ({tx},{ty})")
            moved = True
            time.sleep(0.05)
        jiggle()
        return "moved" if moved else "jiggled"
    except Exception as e:
        log(f"移动失败: {e}")
        return "error"


# ---------------- HTTP ----------------

class Handler(BaseHTTPRequestHandler):
    def _send(self, body, code=200):
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):  # noqa: N802
        global forced_mode
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/point":
            try:
                fx = float(q.get("fx", ["0.5"])[0])
                fy = float(q.get("fy", ["0.5"])[0])
                fw = float(q.get("fw", ["0.0"])[0])
                fh = float(q.get("fh", ["0.0"])[0])
            except ValueError:
                self._send("bad-params", 400)
                return
            self._send(goto_fraction(fx, fy, fw, fh))
        elif u.path == "/jiggle":
            try:
                jiggle()
                self._send("ok")
            except Exception:
                self._send("fail")
        elif u.path == "/ping":
            self._send("pong")
        elif u.path == "/mode":
            m = q.get("force", ["auto"])[0]
            if m in ("auto", "pen", "mouse"):
                forced_mode = m
                log(f"模式切换 -> {m}")
                self._send(m)
            else:
                self._send("bad-mode", 400)
        elif u.path == "/devices":
            import json

            self._send(json.dumps(seen_devices, ensure_ascii=False, indent=2))
        else:
            self._send("not found", 404)

    def log_message(self, *args):
        pass


def serve():
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
        log(f"HTTP 已监听 {PORT}")
        httpd.serve_forever()
    except Exception as e:
        log(f"HTTP 启动失败: {e}")


def main():
    # 注意：窗口的消息队列属于创建它的线程，PumpMessages 必须在本线程执行，
    # 否则收不到 WM_INPUT（之前就在别的线程里 pump，导致完全检测不到设备）。
    hwnd = create_message_window()
    register_raw_input(hwnd)

    threading.Thread(target=serve, daemon=True).start()
    log("助手 v3 启动（笔/鼠标自动区分）")
    win32gui.PumpMessages()
    return 0


if __name__ == "__main__":
    sys.exit(main())
