"""Windows tray client configuration defaults replicated locally."""


class ClientConfig:
    addr = '127.0.0.1'
    port = '6016'


    model_source = 'local'  # 'local', 'custom', or 'builtin'
    model_name = 'paraformer'
    model_api_url = ''
    model_api_key = ''

    shortcut = 'right ctrl'
    hold_mode = True
    suppress = False
    restore_key = True
    threshold = 0.3
    paste = True
    restore_clip = True

    save_audio = True
    audio_name_len = 20

    trash_punc = '，。,.'

    hot_zh = True
    多音字 = True
    声调 = False

    hot_en = True
    hot_rule = True
    hot_kwd = True

    mic_seg_duration = 15
    mic_seg_overlap = 2

    file_seg_duration = 25
    file_seg_overlap = 2

    auto_startup = False
    show_notifications = True
    notify_on_result = False
    log_level = 'INFO'
    audio_input_device = ''
    reconnect_interval = 5
    minimize_to_tray = True


__all__ = ['ClientConfig']
