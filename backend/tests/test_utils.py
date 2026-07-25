from app.utils import assign_display_numbers, sanitize_filename


class TestSanitizeFilename:
    def test_plain_filename_unchanged(self):
        assert sanitize_filename("report.pdf") == "report.pdf"

    def test_strips_directory_components(self):
        assert sanitize_filename("../../etc/passwd") == "passwd"

    def test_strips_windows_style_path(self):
        assert sanitize_filename("C:\\Windows\\System32\\evil.exe") == "evil.exe"

    def test_replaces_unsafe_characters(self):
        assert sanitize_filename("weird name!@#.txt") == "weird_name___.txt"

    def test_strips_leading_dots(self):
        assert sanitize_filename("...hidden.txt") == "hidden.txt"

    def test_empty_filename_gets_fallback(self):
        assert sanitize_filename("") == "upload"

    def test_null_bytes_removed(self):
        assert "\x00" not in sanitize_filename("evil\x00.txt")


class TestAssignDisplayNumbers:
    def test_single_document_numbers_chunks_sequentially(self):
        results = [
            {"payload": {"document_id": "docA"}},
            {"payload": {"document_id": "docA"}},
            {"payload": {"document_id": "docA"}},
        ]
        out = assign_display_numbers(results)
        assert [r["display_number"] for r in out] == ["1.1", "1.2", "1.3"]

    def test_multiple_documents_numbered_by_first_seen_order(self):
        results = [
            {"payload": {"document_id": "docA"}},
            {"payload": {"document_id": "docB"}},
            {"payload": {"document_id": "docA"}},
            {"payload": {"document_id": "docC"}},
        ]
        out = assign_display_numbers(results)
        assert [r["display_number"] for r in out] == ["1.1", "2.1", "1.2", "3.1"]

    def test_missing_document_id_falls_back_to_chunk_id(self):
        results = [{"payload": {"chunk_id": "c1"}}]
        out = assign_display_numbers(results)
        assert out[0]["display_number"] == "1.1"

    def test_does_not_mutate_input(self):
        original = [{"payload": {"document_id": "docA"}}]
        assign_display_numbers(original)
        assert "display_number" not in original[0]
