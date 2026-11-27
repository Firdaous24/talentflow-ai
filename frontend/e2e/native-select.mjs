import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";

// Xvfb + XTest drive Chromium's real native option popup. No app state or DOM values
// are assigned here; both the control and its popup receive physical mouse events.
const nativeInput = String.raw`
import ctypes, ctypes.util, json, sys
from ctypes import c_int, c_uint, c_ulong, c_long, c_void_p, POINTER, Structure
x11 = ctypes.CDLL(ctypes.util.find_library("X11"))
xtst = ctypes.CDLL(ctypes.util.find_library("Xtst"))
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XOpenDisplay.restype = c_void_p
x11.XDefaultRootWindow.argtypes = [c_void_p]
x11.XDefaultRootWindow.restype = c_ulong
x11.XQueryTree.argtypes = [c_void_p,c_ulong,POINTER(c_ulong),POINTER(c_ulong),POINTER(POINTER(c_ulong)),POINTER(c_uint)]
x11.XFree.argtypes = [c_void_p]
x11.XCloseDisplay.argtypes = [c_void_p]
x11.XFlush.argtypes = [c_void_p]
x11.XRaiseWindow.argtypes = [c_void_p,c_ulong]
x11.XSetInputFocus.argtypes = [c_void_p,c_ulong,c_int,c_ulong]
x11.XGetWindowAttributes.argtypes = [c_void_p,c_ulong,c_void_p]
xtst.XTestFakeMotionEvent.argtypes = [c_void_p,c_int,c_int,c_int,c_ulong]
xtst.XTestFakeButtonEvent.argtypes = [c_void_p,c_uint,c_int,c_ulong]
class Attributes(Structure):
    _fields_=[("x",c_int),("y",c_int),("width",c_int),("height",c_int),("border_width",c_int),("depth",c_int),("visual",c_void_p),("root",c_ulong),("window_class",c_int),("bit_gravity",c_int),("win_gravity",c_int),("backing_store",c_int),("backing_planes",c_ulong),("backing_pixel",c_ulong),("save_under",c_int),("colormap",c_ulong),("map_installed",c_int),("map_state",c_int),("all_event_masks",c_long),("your_event_mask",c_long),("do_not_propagate_mask",c_long),("override_redirect",c_int),("screen",c_void_p)]
display=x11.XOpenDisplay(None)
if not display:
    raise SystemExit("Native mouse selection needs DISPLAY; enable NATIVE_MOUSE=1 for automatic Xvfb startup")
try:
    command=json.loads(sys.argv[1])
    if command["action"]=="focus":
        x11.XRaiseWindow(display,command["window"])
        x11.XSetInputFocus(display,command["window"],2,0)
        x11.XFlush(display)
        print("{}")
    elif command["action"] in ("click", "move"):
        xtst.XTestFakeMotionEvent(display,-1,round(command["x"]),round(command["y"]),0)
        if command["action"]=="click":
            xtst.XTestFakeButtonEvent(display,1,1,0)
            xtst.XTestFakeButtonEvent(display,1,0,0)
        x11.XFlush(display)
        print("{}")
    else:
        root=x11.XDefaultRootWindow(display)
        root_return,parent=c_ulong(),c_ulong()
        children=POINTER(c_ulong)()
        count=c_uint()
        x11.XQueryTree(display,root,ctypes.byref(root_return),ctypes.byref(parent),ctypes.byref(children),ctypes.byref(count))
        windows=[]
        for i in range(count.value):
            attributes=Attributes()
            if x11.XGetWindowAttributes(display,children[i],ctypes.byref(attributes)) and attributes.map_state==2:
                windows.append({"id":int(children[i]),"x":attributes.x,"y":attributes.y,"width":attributes.width,"height":attributes.height})
        if children:
            x11.XFree(children)
        print(json.dumps(windows))
finally:
    x11.XCloseDisplay(display)
`;

function input(command) {
  return JSON.parse(
    execFileSync("python3", ["-c", nativeInput, JSON.stringify(command)], {
      encoding: "utf8",
      timeout: 5000,
    }),
  );
}

export async function startNativeDisplay() {
  if (process.env.DISPLAY) return () => {};
  process.env.DISPLAY = ":99";
  const server = spawn("Xvfb", [":99", "-screen", "0", "1920x1200x24", "-ac", "-nolisten", "tcp"], {
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      input({ action: "windows" });
      return () => server.kill("SIGTERM");
    } catch {
      if (server.exitCode !== null) throw new Error("The native Xvfb display failed to start.");
    }
  }
  server.kill("SIGTERM");
  throw new Error("The native Xvfb display did not become ready.");
}

export async function selectNativeOptionByMouse(page, select, value) {
  assert.ok(process.env.DISPLAY, "Enable NATIVE_MOUSE=1 to start the native display.");
  const options = await select.locator("option").evaluateAll((entries) =>
    entries.map((option) => ({ value: option.value, disabled: option.disabled })),
  );
  const optionIndex = options.findIndex((option) => option.value === value);
  assert.ok(optionIndex >= 0, `Native option ${value} exists`);
  assert.equal(options[optionIndex].disabled, false);
  const previousValue = await select.inputValue();
  assert.notEqual(previousValue, value, "Mouse selection must change the value");
  await select.evaluate((control) => {
    control.addEventListener("change", (event) => {
      console.debug("native-select-trusted-change", event.isTrusted);
    }, { once: true });
  });
  const trustedChange = page.waitForEvent("console", {
    predicate: (message) => message.text() === "native-select-trusted-change true",
    timeout: 5000,
  });
  await select.scrollIntoViewIfNeeded();
  const bounds = await select.boundingBox();
  assert.ok(bounds);
  const before = input({ action: "windows" });
  const browserWindow = before.find((window) => window.height > 500 && window.width > 1000);
  assert.ok(browserWindow, "The headed browser window is visible");
  input({ action: "focus", window: browserWindow.id });
  const screen = await page.evaluate(() => ({
    x: window.screenX,
    y: window.screenY + window.outerHeight - window.innerHeight,
  }));
  input({
    action: "click",
    x: screen.x + bounds.x + bounds.width - 16,
    y: screen.y + bounds.y + bounds.height / 2,
  });
  await page.waitForTimeout(150);
  const after = input({ action: "windows" });
  const popup = after.find(
    (window) =>
      !before.some((previous) => previous.id === window.id) &&
      window.width >= bounds.width - 4 &&
      window.height >= options.length * 12 &&
      window.height < 500,
  );
  if (!popup) console.log("Native popup diagnostics", JSON.stringify({ bounds, screen, before, after, options }));
  assert.ok(popup, "A real native Chromium option popup opened");
  console.log("Native popup", JSON.stringify({ bounds, screen, popup, optionIndex, count: options.length }));
  const target = {
    x: popup.x + popup.width / 2,
    y: popup.y + ((optionIndex + 0.5) * popup.height) / options.length,
  };
  input({ action: "move", ...target });
  await page.waitForTimeout(100);
  input({ action: "click", ...target });
  await page.waitForFunction(
    ({ id, expected }) => document.getElementById(id)?.value === expected,
    { id: await select.getAttribute("id"), expected: value },
    { timeout: 5000 },
  );
  assert.equal(await select.inputValue(), value);
  await trustedChange;
  console.log(`Native mouse: arrow click -> option hover/click -> ${previousValue || "placeholder"} -> ${value}`);
}
