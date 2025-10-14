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
    # On Windows, left ctrl and right ctrl have the same keycode,
    # keyboard library triggers based on keycode
    # Even if right ctrl is set, pressing left ctrl will also trigger
    # However, although the keycodes are the same, e.name is different
    # Add a check here, if e.name is not the expected key, return
    shortcut = Config.shortcut or ''
    key_expect = keyboard.normalize_name(shortcut) if shortcut else ''
    key_actual = keyboard.normalize_name(e.name) if e.name else ''
    if not key_expect:
        return False
    return key_expect == key_actual


def launch_task():
    global task

    # Record start time
    t1 = time.time()

    # Put start flag into queue
    asyncio.run_coroutine_threadsafe(
        Cosmic.queue_in.put({'type': 'begin', 'time': t1, 'data': None}),
        Cosmic.loop
    )

    # Notify recording thread to put data into queue
    Cosmic.on = t1

    # Print animation: recording
    status.start()
    _emit_status('recording')

    # Start recognition task
    task = asyncio.run_coroutine_threadsafe(
        send_audio(),
        Cosmic.loop,
    )


def cancel_task():
    # Notify stop recording, close progress bar
    Cosmic.on = False
    status.stop()

    # Cancel coroutine task
    task.cancel()
    _emit_status('ready', 'cancelled')


def finish_task():
    global task

    # Notify stop recording, close progress bar
    Cosmic.on = False
    status.stop()

    # Notify finish task
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


# =================Click mode======================


def count_down(e: Event):
    """Start countdown after press"""
    time.sleep(Config.threshold)
    e.set()


def manage_task(e: Event):
    """
    Detect if e is triggered within threshold time to determine if it's a click or hold
    Perform next action accordingly
    """

    # Record if there's a task
    on = Cosmic.on

    # Start task first
    if not on:
        launch_task()

    # Released key in time, it's a click
    if e.wait(timeout=Config.threshold * 0.8):
        # If task is running, finish it
        if Cosmic.on and on:
            finish_task()

    # Didn't release key in time, it's a hold
    else:
        # Cancel task started by this stack
        if not on:
            cancel_task()

        # Hold, send key
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



# ======================Hold mode==================================


def hold_mode(e: keyboard.KeyboardEvent):
    """Like a walkie-talkie, press to record, release to stop"""
    global task

    if e.event_type == 'down' and not Cosmic.on:
        # Record start time
        launch_task()
    elif e.event_type == 'up':
        # Record duration and mark recording thread to stop putting data into queue
        duration = time.time() - Cosmic.on

        # Cancel or stop task
        if duration < Config.threshold:
            cancel_task()
        else:
            finish_task()

            # After releasing shortcut, press again to restore CapsLock or Shift key state
            if Config.restore_key:
                time.sleep(0.01)
                keyboard.send(Config.shortcut)





# ==================== Bind handler ===============================


def hold_handler(e: keyboard.KeyboardEvent) -> None:

    # Verify key name is correct
    if not shortcut_correct(e):
        return

    # Hold mode
    hold_mode(e)


def click_handler(e: keyboard.KeyboardEvent) -> None:

    # Verify key name is correct
    if not shortcut_correct(e):
        return

    # Click mode
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
        # Click mode must suppress shortcut key
        # When receiving hold, simulate sending key
        handle = keyboard.hook_key(Config.shortcut, click_handler, suppress=True)
    Cosmic.shortcut_handles.append(handle)
    _emit_status('ready')