import keyboard
from util.client_cosmic import Cosmic, console
from client_config import ClientConfig as Config

import time
import asyncio
from threading import Event
from concurrent.futures import ThreadPoolExecutor
from util.client_send_audio import send_audio
from util.my_status import Status


task = asyncio.Future()
status = Status('Start recording', spinner='point')
pool = ThreadPoolExecutor()
pressed = False
released = True
event = Event()


def _emit_status(state, detail=None):
    Cosmic.emit_status(state, detail)


def shortcut_correct(e: keyboard.KeyboardEvent):
    # On my Windows machine, the keycodes for left ctrl and right ctrl are the same.
    # The `keyboard` library triggers based on keycode.
    # Even if right ctrl is set, left ctrl will also trigger the event.
    # However, although the keycodes are the same, the event name `e.name` is different.
    # Add a check here to return if `e.name` is not the key we expect.
    shortcut = Config.shortcut or ''
    key_expect = keyboard.normalize_name(shortcut) if shortcut else ''
    key_actual = keyboard.normalize_name(e.name) if e.name else ''
    if not key_expect:
        return False
    return key_expect == key_actual


def launch_task():
    global task

    # 记录开始时间
    t1 = time.time()

    # 将开始标志放入队列
    asyncio.run_coroutine_threadsafe(
        Cosmic.queue_in.put({'type': 'begin', 'time': t1, 'data': None}),
        Cosmic.loop
    )

    # 通知录音线程可以向队列放数据了
    Cosmic.on = t1

    # 打印动画：正在录音
    status.start()
    _emit_status('recording')

    # 启动识别任务
    task = asyncio.run_coroutine_threadsafe(
        send_audio(),
        Cosmic.loop,
    )


def cancel_task():
    # 通知停止录音，关掉滚动条
    Cosmic.on = False
    status.stop()

    # 取消协程任务
    task.cancel()
    _emit_status('ready', 'cancelled')


def finish_task():
    global task

    # 通知停止录音，关掉滚动条
    Cosmic.on = False
    status.stop()

    # 通知结束任务
    asyncio.run_coroutine_threadsafe(
        Cosmic.queue_in.put(
            {'type': 'finish',
             'time': time.time(),
             'data': None
             },
        ),
        Cosmic.loop
    )
    _emit_status('ready')


# =================单击模式======================


def count_down(e: Event):
    """按下后，开始倒数"""
    time.sleep(Config.threshold)
    e.set()


def manage_task(e: Event):
    # By checking if e is triggered within the threshold time,
    # we can determine if it's a single click or a long press.
    #
    # This function is only used in click mode.
    # When the hotkey is pressed, this function is started in a sub-thread.
    # It waits for a moment; if the hotkey is released during this time, e.is_set() becomes true.
    # If the hotkey is not released, e.is_set() remains false.
    on = Cosmic.on

    # If not recording, start recording
    if not on:
        launch_task()

    # If the hotkey is released within the threshold time, it's a single click, so finish the task.
    if e.wait(timeout=Config.threshold * 0.8):
        # If it was recording before this action, finish it.
        if Cosmic.on and on:
            finish_task()

    # If the hotkey is held down, it's a long press. If it was not recording before, cancel the task.
    else:
        # If it was not recording before, cancel the recording task.
        if not on:
            cancel_task()

        # Simulate another key press to restore the original state of keys like CapsLock.
        keyboard.send(Config.shortcut)


def click_mode(e: keyboard.KeyboardEvent):
    global pressed, released, event

    if e.event_type == 'down' and released:
        pressed, released = True, False
        event = Event()
        pool.submit(count_down, event)
        pool.submit(manage_task, event)

    elif e.event_type == 'up' and pressed:
        pressed, released = False, True
        event.set()


# ====================== Hold Mode ==================================


def hold_mode(e: keyboard.KeyboardEvent):
    # Long press mode
    global task

    if e.event_type == 'down' and not Cosmic.on:
        # Press to start recording
        launch_task()
    elif e.event_type == 'up':
        # Release to stop recording
        duration = time.time() - Cosmic.on

        # If the duration is less than the threshold, it's a short press, cancel the recording.
        if duration < Config.threshold:
            cancel_task()
        else:
            finish_task()

        # After releasing the hotkey, press it again to restore the state of keys like CapsLock or Shift.
        if Config.restore_key:
            time.sleep(0.01)
            keyboard.send(Config.shortcut)


# ==================== Bind Handlers ===============================


def hold_handler(e: keyboard.KeyboardEvent) -> None:
    # Handler for hold mode

    if not shortcut_correct(e):
        return

    # Call the specific handler for hold mode
    hold_mode(e)


def click_handler(e: keyboard.KeyboardEvent) -> None:
    # Handler for click mode

    if not shortcut_correct(e):
        return

    # Call the specific handler for click mode
    click_mode(e)


def unbond_shortcut():
    global pressed, released
    for handle in list(Cosmic.shortcut_handles):
        try:
            handle.remove()
        except Exception:
            pass
    Cosmic.shortcut_handles = []
    pressed = False
    released = True


def bond_shortcut():
    unbond_shortcut()
    if Config.hold_mode:
        handle = keyboard.hook_key(Config.shortcut, hold_handler, suppress=Config.suppress)
    else:
        # 单击模式，必须得阻塞快捷键
        # 收到长按时，再模拟发送按键
        handle = keyboard.hook_key(Config.shortcut, click_handler, suppress=True)
    Cosmic.shortcut_handles.append(handle)
    _emit_status('ready')