import argparse
import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont


def register_fonts():
    fonts = [
        (r"C:\Windows\Fonts\BIZ-UDGothicR.ttc", "JP"),
        (r"C:\Windows\Fonts\YuGothM.ttc", "JP"),
        (r"C:\Windows\Fonts\meiryo.ttc", "JP"),
    ]
    bold_fonts = [
        (r"C:\Windows\Fonts\BIZ-UDGothicB.ttc", "JP-Bold"),
        (r"C:\Windows\Fonts\YuGothB.ttc", "JP-Bold"),
        (r"C:\Windows\Fonts\meiryob.ttc", "JP-Bold"),
    ]
    for path, name in fonts:
        if Path(path).exists():
            pdfmetrics.registerFont(TTFont(name, path))
            break
    for path, name in bold_fonts:
        if Path(path).exists():
            pdfmetrics.registerFont(TTFont(name, path))
            break


def para(text, style):
    return Paragraph(str(text).replace("\n", "<br/>"), style)


def make_styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("title", parent=base["Title"], fontName="JP-Bold", fontSize=15, leading=17, alignment=TA_CENTER, textColor=colors.HexColor("#075AC8"), spaceAfter=4),
        "subtitle": ParagraphStyle("subtitle", parent=base["BodyText"], fontName="JP", fontSize=8, leading=9.8, alignment=TA_CENTER, textColor=colors.HexColor("#222222"), spaceAfter=5),
        "th": ParagraphStyle("th", parent=base["BodyText"], fontName="JP-Bold", fontSize=8, leading=9.4, alignment=TA_CENTER, textColor=colors.white),
        "td": ParagraphStyle("td", parent=base["BodyText"], fontName="JP", fontSize=7.6, leading=9.3, alignment=TA_LEFT),
        "h2": ParagraphStyle("h2", parent=base["Heading2"], fontName="JP-Bold", fontSize=9.4, leading=11, textColor=colors.HexColor("#075AC8"), spaceAfter=2),
        "body": ParagraphStyle("body", parent=base["BodyText"], fontName="JP", fontSize=8, leading=9.8, alignment=TA_LEFT),
        "small": ParagraphStyle("small", parent=base["BodyText"], fontName="JP", fontSize=6.5, leading=7.7, textColor=colors.HexColor("#333333")),
    }


def build_during(data, output_dir):
    st = make_styles()
    during = data["during"]
    doc = SimpleDocTemplate(
        str(output_dir / "02-during-explanation-a4.pdf"),
        pagesize=A4,
        rightMargin=7 * mm,
        leftMargin=7 * mm,
        topMargin=7 * mm,
        bottomMargin=7 * mm,
    )
    story = [
        para(during.get("title", f"進行中カンペ｜{data['title']}"), st["title"]),
        para(during.get("summary", "紙は読まず、一瞬だけ見てスライドへ戻る。"), st["subtitle"]),
    ]
    rows = [["頁", "必ず言う一言", "補足1点", "つなぎ/問い"]]
    for row in during["rows"]:
        rows.append([row["page"], row["must"], row.get("supplement", ""), row.get("transition", "")])
    table_data = []
    for i, row in enumerate(rows):
        style = st["th"] if i == 0 else st["td"]
        table_data.append([para(cell, style) for cell in row])
    table = Table(table_data, colWidths=[15 * mm, 55 * mm, 61 * mm, 50 * mm], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#075AC8")),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#AEB7C2")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("BACKGROUND", (0, 1), (0, -1), colors.HexColor("#EEF5FF")),
        ("ROWBACKGROUNDS", (1, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
    ]))
    story.append(table)
    if during.get("source_note"):
        story.append(Spacer(1, 3))
        story.append(para(during["source_note"], st["small"]))
    doc.build(story)


def section_box(title, lines, st):
    content = [para(title, st["h2"])]
    for line in lines:
        content.append(para(line, st["body"]))
    table = Table([[content]], colWidths=[87 * mm])
    table.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#AEB7C2")),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return table


def build_after(data, output_dir):
    st = make_styles()
    after = data["after"]
    doc = SimpleDocTemplate(
        str(output_dir / "03-after-explanation-a4.pdf"),
        pagesize=A4,
        rightMargin=8 * mm,
        leftMargin=8 * mm,
        topMargin=7 * mm,
        bottomMargin=7 * mm,
    )
    story = [
        para(after.get("title", f"{data['title']}｜説明後の持ち帰りシート"), st["title"]),
        para(after["conclusion"], st["subtitle"]),
    ]
    sections = after["sections"]
    left_sections = sections[0::2]
    right_sections = sections[1::2]
    def stack(items):
        out = []
        for item in items:
            out.append(section_box(item["title"], item["lines"], st))
            out.append(Spacer(1, 4))
        return out
    grid = Table([[stack(left_sections), stack(right_sections)]], colWidths=[90 * mm, 90 * mm])
    grid.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(grid)
    if after.get("source_note"):
        story.append(Spacer(1, 3))
        story.append(para(after["source_note"], st["small"]))
    doc.build(story)


def main():
    parser = argparse.ArgumentParser(description="Build KYOZAI Support A4 PDFs from JSON.")
    parser.add_argument("--input", required=True, help="Path to support-a4.json")
    parser.add_argument("--output-dir", required=True, help="Output directory")
    args = parser.parse_args()
    register_fonts()
    input_path = Path(args.input)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    data = json.loads(input_path.read_text(encoding="utf-8"))
    build_during(data, output_dir)
    build_after(data, output_dir)
    print(output_dir / "02-during-explanation-a4.pdf")
    print(output_dir / "03-after-explanation-a4.pdf")


if __name__ == "__main__":
    main()
