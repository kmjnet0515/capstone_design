"""
Тесты для новой архитектуры OLE Compound Document
"""
import unittest
import tempfile
import os
from compoundfiles.writer import CompoundFileWriter
from compoundfiles.reader import CompoundFileReader


class TestNewArchitecture(unittest.TestCase):
    """Тесты для новой архитектуры OLE Compound Document"""

    def setUp(self):
        """Подготовка тестового окружения"""
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        """Очистка после тестов"""
        # Удаляем временные файлы
        for file in os.listdir(self.temp_dir):
            os.remove(os.path.join(self.temp_dir, file))
        os.rmdir(self.temp_dir)

    def test_model_creation_and_writing(self):
        """Тест создания и записи модели"""
        temp_file = os.path.join(self.temp_dir, "test_output.cfb")

        # Создаем файл с помощью CompoundFileWriter
        with CompoundFileWriter(temp_file) as writer:
            # Добавляем хранилище
            forms_storage = writer.create_storage(writer.root, "Forms")

            # Добавляем потоки
            writer.create_stream(writer.root, "Config", b"Configuration data")
            writer.create_stream(forms_storage, "MainForm", b"Form definition")

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Читаем файл и проверяем содержимое
        with CompoundFileReader(temp_file) as reader:
            root_items = list(reader.root)

            # Проверяем, что есть хранилище Forms и поток Config
            self.assertEqual(len(root_items), 2)

            # Находим и проверяем хранилище Forms
            forms_item = None
            config_item = None
            for item in root_items:
                if item.name == "Forms":
                    forms_item = item
                elif item.name == "Config":
                    config_item = item

            self.assertIsNotNone(forms_item)
            self.assertIsNotNone(config_item)
            self.assertTrue(forms_item.isdir)
            self.assertTrue(config_item.isfile)

            # Проверяем содержимое Config
            with reader.open(config_item) as stream:
                content = stream.read()
                self.assertEqual(content, b"Configuration data")

            # Проверяем содержимое MainForm в хранилище Forms
            forms_children = list(forms_item)
            self.assertEqual(len(forms_children), 1)

            form_item = forms_children[0]
            self.assertEqual(form_item.name, "MainForm")
            self.assertTrue(form_item.isfile)

            with reader.open(form_item) as stream:
                content = stream.read()
                self.assertEqual(content, b"Form definition")

    def test_writer_functionality(self):
        """Тест функциональности Writer"""
        temp_file = os.path.join(self.temp_dir, "test_output.cfb")

        # Создаем файл с помощью CompoundFileWriter
        with CompoundFileWriter(temp_file) as writer:
            # Добавляем данные
            writer.create_stream(writer.root, "TestStream", b"Test data for writing")
            test_storage = writer.create_storage(writer.root, "TestStorage")
            writer.create_stream(test_storage, "InnerStream", b"Inner stream data")

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))
        self.assertGreater(os.path.getsize(temp_file), 0)

        # Проверяем содержимое
        with CompoundFileReader(temp_file) as reader:
            root_items = list(reader.root)
            self.assertEqual(len(root_items), 2)  # TestStream и TestStorage

            # Проверяем TestStream
            test_stream = None
            test_storage = None
            for item in root_items:
                if item.name == "TestStream":
                    test_stream = item
                elif item.name == "TestStorage":
                    test_storage = item

            self.assertIsNotNone(test_stream)
            self.assertIsNotNone(test_storage)
            self.assertTrue(test_stream.isfile)
            self.assertTrue(test_storage.isdir)

            # Проверяем содержимое TestStream
            with reader.open(test_stream) as stream:
                content = stream.read()
                self.assertEqual(content, b"Test data for writing")

            # Проверяем содержимое InnerStream в TestStorage
            storage_items = list(test_storage)
            self.assertEqual(len(storage_items), 1)

            inner_stream = storage_items[0]
            self.assertEqual(inner_stream.name, "InnerStream")
            self.assertTrue(inner_stream.isfile)

            with reader.open(inner_stream) as stream:
                content = stream.read()
                self.assertEqual(content, b"Inner stream data")

    def test_api_integration(self):
        """Тест интеграции API"""
        temp_file = os.path.join(self.temp_dir, "api_integration_test.cfb")

        # Создаем файл с помощью CompoundFileWriter
        with CompoundFileWriter(temp_file) as writer:
            # Создаем структуру
            root_storage = writer.create_storage(writer.root, "Root")
            writer.create_stream(root_storage, "Config", b"Configuration")
            forms_storage = writer.create_storage(root_storage, "Forms")
            writer.create_stream(forms_storage, "MainForm", b"Main form definition")

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем содержимое
        with CompoundFileReader(temp_file) as reader:
            root_items = list(reader.root)
            self.assertEqual(len(root_items), 1)  # Только Root

            root_item = root_items[0]
            self.assertEqual(root_item.name, "Root")
            self.assertTrue(root_item.isdir)

            # Проверяем содержимое Root
            root_children = list(root_item)
            self.assertEqual(len(root_children), 2)  # Config и Forms

            config_item = None
            forms_item = None
            for item in root_children:
                if item.name == "Config":
                    config_item = item
                elif item.name == "Forms":
                    forms_item = item

            self.assertIsNotNone(config_item)
            self.assertIsNotNone(forms_item)
            self.assertTrue(config_item.isfile)
            self.assertTrue(forms_item.isdir)

            # Проверяем содержимое Config
            with reader.open(config_item) as stream:
                content = stream.read()
                self.assertEqual(content, b"Configuration")

            # Проверяем содержимое MainForm в Forms
            forms_children = list(forms_item)
            self.assertEqual(len(forms_children), 1)

            form_item = forms_children[0]
            self.assertEqual(form_item.name, "MainForm")
            self.assertTrue(form_item.isfile)

            with reader.open(form_item) as stream:
                content = stream.read()
                self.assertEqual(content, b"Main form definition")

    def test_small_vs_large_streams(self):
        """Тест различия между маленькими и большими потоками"""
        temp_file = os.path.join(self.temp_dir, "size_test.cfb")

        # Создаем файл с разными размерами потоков
        with CompoundFileWriter(temp_file) as writer:
            # Добавляем маленький поток (меньше 4096 байт)
            small_data = b"Small data" * 10  # 100 байт
            writer.create_stream(writer.root, "SmallStream", small_data)

            # Добавляем большой поток (больше 4096 байт)
            large_data = b"Large data" * 500  # 5000 байт
            writer.create_stream(writer.root, "LargeStream", large_data)

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем содержимое
        with CompoundFileReader(temp_file) as reader:
            root_items = list(reader.root)
            self.assertEqual(len(root_items), 2)

            small_item = None
            large_item = None
            for item in root_items:
                if item.name == "SmallStream":
                    small_item = item
                elif item.name == "LargeStream":
                    large_item = item

            self.assertIsNotNone(small_item)
            self.assertIsNotNone(large_item)

            # Проверяем размеры
            self.assertEqual(small_item.size, len(b"Small data" * 10))
            self.assertEqual(large_item.size, len(b"Large data" * 500))

            # Проверяем содержимое
            with reader.open(small_item) as stream:
                content = stream.read()
                self.assertEqual(content, b"Small data" * 10)

            with reader.open(large_item) as stream:
                content = stream.read()
                self.assertEqual(content, b"Large data" * 500)

    def test_nested_structures(self):
        """Тест вложенных структур"""
        temp_file = os.path.join(self.temp_dir, "nested_test.cfb")

        # Создаем файл с вложенными структурами
        with CompoundFileWriter(temp_file) as writer:
            # Создаем вложенную структуру
            level1 = writer.create_storage(writer.root, "Level1")
            level2 = writer.create_storage(level1, "Level2")
            level3 = writer.create_storage(level2, "Level3")

            # Добавляем потоки на разных уровнях
            writer.create_stream(writer.root, "RootStream", b"Root level data")
            writer.create_stream(level1, "L1Stream", b"Level 1 data")
            writer.create_stream(level2, "L2Stream", b"Level 2 data")
            writer.create_stream(level3, "L3Stream", b"Level 3 data")

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем структуру
        with CompoundFileReader(temp_file) as reader:
            # Проверяем корневой уровень
            root_items = list(reader.root)
            self.assertEqual(len(root_items), 2)  # RootStream и Level1

            # Находим Level1
            level1_item = None
            root_stream = None
            for item in root_items:
                if item.name == "Level1":
                    level1_item = item
                elif item.name == "RootStream":
                    root_stream = item

            self.assertIsNotNone(level1_item)
            self.assertIsNotNone(root_stream)

            # Проверяем содержимое RootStream
            with reader.open(root_stream) as stream:
                content = stream.read()
                self.assertEqual(content, b"Root level data")

            # Проверяем уровень 1
            level1_items = list(level1_item)
            self.assertEqual(len(level1_items), 2)  # L1Stream и Level2

            # Находим Level2
            level2_item = None
            l1_stream = None
            for item in level1_items:
                if item.name == "Level2":
                    level2_item = item
                elif item.name == "L1Stream":
                    l1_stream = item

            self.assertIsNotNone(level2_item)
            self.assertIsNotNone(l1_stream)

            # Проверяем содержимое L1Stream
            with reader.open(l1_stream) as stream:
                content = stream.read()
                self.assertEqual(content, b"Level 1 data")

            # Проверяем уровень 2
            level2_items = list(level2_item)
            self.assertEqual(len(level2_items), 2)  # L2Stream и Level3

            # Находим Level3
            level3_item = None
            l2_stream = None
            for item in level2_items:
                if item.name == "Level3":
                    level3_item = item
                elif item.name == "L2Stream":
                    l2_stream = item

            self.assertIsNotNone(level3_item)
            self.assertIsNotNone(l2_stream)

            # Проверяем содержимое L2Stream
            with reader.open(l2_stream) as stream:
                content = stream.read()
                self.assertEqual(content, b"Level 2 data")

            # Проверяем уровень 3
            level3_items = list(level3_item)
            self.assertEqual(len(level3_items), 1)  # L3Stream

            l3_stream = level3_items[0]
            self.assertEqual(l3_stream.name, "L3Stream")

            # Проверяем содержимое L3Stream
            with reader.open(l3_stream) as stream:
                content = stream.read()
                self.assertEqual(content, b"Level 3 data")

    def test_path_based_access(self):
        """Тест доступа по пути"""
        temp_file = os.path.join(self.temp_dir, "path_test.cfb")

        # Создаем файл с помощью CompoundFileWriter
        with CompoundFileWriter(temp_file) as writer:
            # Создаем структуру
            documents_storage = writer.create_storage(writer.root, "Documents")
            reports_storage = writer.create_storage(documents_storage, "Reports")
            writer.create_stream(documents_storage, "Doc1", b"Document 1")
            writer.create_stream(reports_storage, "Report1", b"Report 1")

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем содержимое
        with CompoundFileReader(temp_file) as reader:
            root_items = list(reader.root)
            self.assertEqual(len(root_items), 1)  # Только Documents

            documents_item = root_items[0]
            self.assertEqual(documents_item.name, "Documents")
            self.assertTrue(documents_item.isdir)

            # Проверяем содержимое Documents
            documents_children = list(documents_item)
            self.assertEqual(len(documents_children), 2)  # Doc1 и Reports

            doc1_item = None
            reports_item = None
            for item in documents_children:
                if item.name == "Doc1":
                    doc1_item = item
                elif item.name == "Reports":
                    reports_item = item

            self.assertIsNotNone(doc1_item)
            self.assertIsNotNone(reports_item)
            self.assertTrue(doc1_item.isfile)
            self.assertTrue(reports_item.isdir)

            # Проверяем содержимое Doc1
            with reader.open(doc1_item) as stream:
                content = stream.read()
                self.assertEqual(content, b"Document 1")

            # Проверяем содержимое Report1 в Reports
            reports_children = list(reports_item)
            self.assertEqual(len(reports_children), 1)

            report1_item = reports_children[0]
            self.assertEqual(report1_item.name, "Report1")
            self.assertTrue(report1_item.isfile)

            with reader.open(report1_item) as stream:
                content = stream.read()
                self.assertEqual(content, b"Report 1")


if __name__ == '__main__':
    unittest.main()