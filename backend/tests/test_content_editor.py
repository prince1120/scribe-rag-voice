from app.services import content_editor


class TestIsEditable:
    def test_known_extensions_are_editable(self):
        for ext in (".txt", ".md", ".csv", ".docx", ".pptx", ".xlsx", ".pdf"):
            assert content_editor.is_editable(ext)

    def test_unknown_extension_not_editable(self):
        assert not content_editor.is_editable(".zip")
        assert not content_editor.is_editable(".exe")


class TestPlainTextRoundTrip:
    def test_txt_round_trip(self, tmp_path):
        f = tmp_path / "note.txt"
        content_editor.write_editable_text(str(f), ".txt", "hello world")
        assert content_editor.extract_editable_text(str(f), ".txt") == "hello world"

    def test_md_round_trip(self, tmp_path):
        f = tmp_path / "note.md"
        text = "# Heading\n\nSome body text."
        content_editor.write_editable_text(str(f), ".md", text)
        assert content_editor.extract_editable_text(str(f), ".md") == text


class TestDocxRoundTrip:
    def test_paragraphs_survive_round_trip(self, tmp_path):
        f = tmp_path / "doc.docx"
        text = "First paragraph.\n\nSecond paragraph."
        content_editor.write_editable_text(str(f), ".docx", text)
        extracted = content_editor.extract_editable_text(str(f), ".docx")
        assert "First paragraph." in extracted
        assert "Second paragraph." in extracted


class TestPptxRoundTrip:
    def test_slides_survive_round_trip(self, tmp_path):
        f = tmp_path / "deck.pptx"
        text = "## Slide 1\nIntro slide\n\n## Slide 2\nSecond slide"
        content_editor.write_editable_text(str(f), ".pptx", text)
        extracted = content_editor.extract_editable_text(str(f), ".pptx")
        assert "## Slide 1" in extracted
        assert "Intro slide" in extracted
        assert "## Slide 2" in extracted
        assert "Second slide" in extracted

    def test_text_without_slide_markers_still_creates_a_slide(self, tmp_path):
        f = tmp_path / "deck.pptx"
        content_editor.write_editable_text(str(f), ".pptx", "just some text, no markers")
        extracted = content_editor.extract_editable_text(str(f), ".pptx")
        assert "just some text" in extracted


class TestXlsxRoundTrip:
    def test_single_sheet_round_trip(self, tmp_path):
        f = tmp_path / "data.xlsx"
        text = "## Sheet: Sheet1\nname,age\nAlice,30\nBob,25\n"
        content_editor.write_editable_text(str(f), ".xlsx", text)
        extracted = content_editor.extract_editable_text(str(f), ".xlsx")
        assert "Alice" in extracted
        assert "Bob" in extracted

    def test_multi_sheet_round_trip(self, tmp_path):
        f = tmp_path / "data.xlsx"
        text = "## Sheet: A\nx,y\n1,2\n\n## Sheet: B\np,q\n3,4\n"
        content_editor.write_editable_text(str(f), ".xlsx", text)
        extracted = content_editor.extract_editable_text(str(f), ".xlsx")
        assert "## Sheet: A" in extracted
        assert "## Sheet: B" in extracted


class TestPdfRoundTrip:
    def test_pdf_generation_produces_readable_text(self, tmp_path):
        f = tmp_path / "doc.pdf"
        text = "## Page 1\nHello from page one."
        content_editor.write_editable_text(str(f), ".pdf", text)
        extracted = content_editor.extract_editable_text(str(f), ".pdf")
        assert "Hello from page one" in extracted

    def test_pdf_handles_non_latin1_characters_without_crashing(self, tmp_path):
        f = tmp_path / "doc.pdf"
        # Emoji/CJK are outside latin-1 — must not raise, just degrade gracefully.
        content_editor.write_editable_text(str(f), ".pdf", "Hello 😀 世界")
        assert f.exists()
