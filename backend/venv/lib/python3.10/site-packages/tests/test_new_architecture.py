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

    def test_document_creation_and_writing(self):
        """Тест создания и записи документа"""
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


if __name__ == '__main__':
    unittest.main()