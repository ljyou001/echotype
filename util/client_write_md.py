from util.hot_kwds import kwd_list
import time
from pathlib import Path
from os import makedirs

# def do_updata_kwd(kwd_text: str):
#     """
#     Remove extra spaces from each line in keyword text and add to list
#     """
#
#     kwd_list = Cosmic.kwd_list
#     kwd_list.clear(); kwd_list.append('')
#     for kwd in kwd_text.splitlines():
#         kwd = kwd.strip()
#         if not kwd or kwd.startswith('#'): continue
#         kwd_list.append(kwd)
#     return len(kwd_list)

header_md = r'''```txt
Regular Expression Tip

Match audio file link: \[(.+)\]\((.{10,})\)[\s]*
Replace with HTML control: <audio controls><source src="$2" type="audio/mpeg">$1</audio>\n\n

Match HTML control: <audio controls><source src="(.+)" type="audio/mpeg">(.+)</audio>\n\n
Replace with file link: [$2]($1) 
```


'''


def create_md(file_md):
    with open(file_md, 'w', encoding="utf-8") as f:
        f.write(header_md)


def write_md(text: str, time_start: float, file_audio: Path):


    time_year = time.strftime('%Y', time.localtime(time_start))
    time_month = time.strftime('%m', time.localtime(time_start))
    time_day = time.strftime('%d', time.localtime(time_start))
    time_hms = time.strftime('%H:%M:%S', time.localtime(time_start))
    folder_path = Path() / time_year / time_month
    makedirs(folder_path, exist_ok=True)

    # List elements are tuples containing: keyword, md path
    md_list = [(kwd, folder_path / f'{kwd + "-" if kwd else ""}{time_day}.md')
               for kwd in kwd_list
               if text.startswith(kwd)]

    # Write recognition record to md file
    for kwd, file_md in md_list:

        # Ensure md file exists
        if not file_md.exists():
            create_md(file_md)

        # Write to md
        with open(file_md, 'a', encoding="utf-8") as f:
            path_ = file_audio.relative_to(file_md.parent).as_posix().replace(" ", "%20")
            text_ = text[len(kwd):].lstrip("，。,.")
            f.write(f'[{time_hms}]({path_}) {text_}\n\n')
