"""
Тесты для проверки корректности структуры файлов Compound File
"""
import unittest
import os
import tempfile
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from compoundfiles.reader import CompoundFileReader
from compoundfiles.writer import CompoundFileWriter


class TestStructureCorrectness(unittest.TestCase):
    """Тесты для проверки корректности структуры файлов Compound File"""

    def setUp(self):
        """Подготовка тестового окружения"""
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        """Очистка после тестов"""
        # Удаляем временные файлы
        for file in os.listdir(self.temp_dir):
            os.remove(os.path.join(self.temp_dir, file))
        os.rmdir(self.temp_dir)

    def test_single_stream_structure(self):
        """Тест структуры с одним потоком"""
        temp_file = os.path.join(self.temp_dir, 'single_stream.cfb')
        
        test_data = b'Single stream test data'
        with CompoundFileWriter(temp_file) as writer:
            writer.create_stream(writer.root, "test_stream", test_data)

        # Проверяем структуру файла
        with CompoundFileReader(temp_file) as cfr:
            root_items = list(cfr.root)
            self.assertEqual(len(root_items), 1)

            stream = root_items[0]
            self.assertTrue(stream.isfile)
            self.assertEqual(stream.name, 'test_stream')
            self.assertEqual(stream.size, len(test_data))

            # Проверяем содержимое
            with cfr.open(stream) as s:
                content = s.read()
                self.assertEqual(content, test_data)

    def test_single_storage_structure(self):
        """Тест структуры с одним хранилищем"""
        temp_file = os.path.join(self.temp_dir, 'single_storage.cfb')
        
        with CompoundFileWriter(temp_file) as writer:
            writer.create_storage(writer.root, "test_storage")

        # Проверяем структуру файла
        with CompoundFileReader(temp_file) as cfr:
            root_items = list(cfr.root)
            self.assertEqual(len(root_items), 1)

            storage = root_items[0]
            self.assertTrue(storage.isdir)
            self.assertEqual(storage.name, 'test_storage')

    def test_mixed_structure(self):
        """Тест структуры с потоками и хранилищами"""
        temp_file = os.path.join(self.temp_dir, 'mixed.cfb')
        
        with CompoundFileWriter(temp_file) as writer:
            # Создаем хранилище
            storage = writer.create_storage(writer.root, "test_folder")
            # Создаем потоки
            writer.create_stream(writer.root, "root_stream", b'Root stream data')
            writer.create_stream(storage, "folder_stream", b'Folder stream data')

        # Проверяем структуру файла
        with CompoundFileReader(temp_file) as cfr:
            root_items = list(cfr.root)
            self.assertEqual(len(root_items), 2)  # root_stream и test_folder

            # Находим элементы
            root_stream = None
            test_folder = None
            for item in root_items:
                if item.name == 'root_stream':
                    root_stream = item
                elif item.name == 'test_folder':
                    test_folder = item

            self.assertIsNotNone(root_stream)
            self.assertIsNotNone(test_folder)
            self.assertTrue(root_stream.isfile)
            self.assertTrue(test_folder.isdir)

            # Проверяем содержимое root_stream
            with cfr.open(root_stream) as s:
                content = s.read()
                self.assertEqual(content, b'Root stream data')

            # Проверяем содержимое folder_stream
            folder_items = list(test_folder)
            self.assertEqual(len(folder_items), 1)

            folder_stream = folder_items[0]
            self.assertEqual(folder_stream.name, 'folder_stream')
            self.assertTrue(folder_stream.isfile)

            with cfr.open(folder_stream) as s:
                content = s.read()
                self.assertEqual(content, b'Folder stream data')

    def test_deep_nested_structure(self):
        """Тест глубоко вложенной структуры"""
        temp_file = os.path.join(self.temp_dir, 'deep_nested.cfb')
        
        with CompoundFileWriter(temp_file) as writer:
            # Создаем глубоко вложенную структуру
            level1 = writer.create_storage(writer.root, "Level1")
            level2 = writer.create_storage(level1, "Level2")
            level3 = writer.create_storage(level2, "Level3")
            
            # Добавляем потоки на каждом уровне
            writer.create_stream(writer.root, "RootStream", b'Root level data')
            writer.create_stream(level1, "L1Stream", b'Level 1 data')
            writer.create_stream(level2, "L2Stream", b'Level 2 data')
            writer.create_stream(level3, "L3Stream", b'Level 3 data')

        # Проверяем структуру файла
        with CompoundFileReader(temp_file) as cfr:
            # Проверяем корневой уровень
            root_items = list(cfr.root)
            self.assertEqual(len(root_items), 2)  # RootStream и Level1

            # Находим элементы
            root_stream = None
            level1_item = None
            for item in root_items:
                if item.name == 'RootStream':
                    root_stream = item
                elif item.name == 'Level1':
                    level1_item = item

            self.assertIsNotNone(root_stream)
            self.assertIsNotNone(level1_item)

            # Проверяем содержимое RootStream
            with cfr.open(root_stream) as s:
                content = s.read()
                self.assertEqual(content, b'Root level data')

            # Проверяем уровень 1
            level1_items = list(level1_item)
            self.assertEqual(len(level1_items), 2)  # L1Stream и Level2

            l1_stream = None
            level2_item = None
            for item in level1_items:
                if item.name == 'L1Stream':
                    l1_stream = item
                elif item.name == 'Level2':
                    level2_item = item

            self.assertIsNotNone(l1_stream)
            self.assertIsNotNone(level2_item)

            # Проверяем содержимое L1Stream
            with cfr.open(l1_stream) as s:
                content = s.read()
                self.assertEqual(content, b'Level 1 data')

            # Проверяем уровень 2
            level2_items = list(level2_item)
            self.assertEqual(len(level2_items), 2)  # L2Stream и Level3

            l2_stream = None
            level3_item = None
            for item in level2_items:
                if item.name == 'L2Stream':
                    l2_stream = item
                elif item.name == 'Level3':
                    level3_item = item

            self.assertIsNotNone(l2_stream)
            self.assertIsNotNone(level3_item)

            # Проверяем содержимое L2Stream
            with cfr.open(l2_stream) as s:
                content = s.read()
                self.assertEqual(content, b'Level 2 data')

            # Проверяем уровень 3
            level3_items = list(level3_item)
            self.assertEqual(len(level3_items), 1)  # L3Stream

            l3_stream = level3_items[0]
            self.assertEqual(l3_stream.name, 'L3Stream')

            # Проверяем содержимое L3Stream
            with cfr.open(l3_stream) as s:
                content = s.read()
                self.assertEqual(content, b'Level 3 data')

    def test_duplicate_names_handling(self):
        """Тест обработки дубликатов имен"""
        temp_file = os.path.join(self.temp_dir, 'duplicate_names.cfb')
        
        with CompoundFileWriter(temp_file) as writer:
            # Создаем потоки с одинаковыми именами в разных местах
            storage1 = writer.create_storage(writer.root, "Folder1")
            storage2 = writer.create_storage(writer.root, "Folder2")
            
            # Создаем потоки с одинаковыми именами в разных хранилищах
            writer.create_stream(writer.root, "common_stream", b'Root common data')
            writer.create_stream(storage1, "common_stream", b'Folder1 common data')
            writer.create_stream(storage2, "common_stream", b'Folder2 common data')

        # Проверяем структуру файла
        with CompoundFileReader(temp_file) as cfr:
            root_items = list(cfr.root)
            self.assertEqual(len(root_items), 3)  # Folder1, Folder2, common_stream

            # Проверяем, что все элементы существуют
            folder1 = None
            folder2 = None
            root_common = None
            for item in root_items:
                if item.name == 'Folder1':
                    folder1 = item
                elif item.name == 'Folder2':
                    folder2 = item
                elif item.name == 'common_stream':
                    root_common = item

            self.assertIsNotNone(folder1)
            self.assertIsNotNone(folder2)
            self.assertIsNotNone(root_common)

            # Проверяем содержимое корневого потока
            with cfr.open(root_common) as s:
                content = s.read()
                self.assertEqual(content, b'Root common data')

            # Проверяем содержимое потоков в Folder1
            folder1_items = list(folder1)
            self.assertEqual(len(folder1_items), 1)
            folder1_common = folder1_items[0]
            self.assertEqual(folder1_common.name, 'common_stream')
            with cfr.open(folder1_common) as s:
                content = s.read()
                self.assertEqual(content, b'Folder1 common data')

            # Проверяем содержимое потоков в Folder2
            folder2_items = list(folder2)
            self.assertEqual(len(folder2_items), 1)
            folder2_common = folder2_items[0]
            self.assertEqual(folder2_common.name, 'common_stream')
            with cfr.open(folder2_common) as s:
                content = s.read()
                self.assertEqual(content, b'Folder2 common data')

    def test_empty_storage_structure(self):
        """Тест структуры с пустыми хранилищами"""
        temp_file = os.path.join(self.temp_dir, 'empty_storage.cfb')
        
        with CompoundFileWriter(temp_file) as writer:
            # Создаем пустое хранилище
            empty_storage = writer.create_storage(writer.root, "EmptyFolder")
            # Создаем обычный поток
            writer.create_stream(writer.root, "normal_stream", b'Normal data')

        # Проверяем структуру файла
        with CompoundFileReader(temp_file) as cfr:
            root_items = list(cfr.root)
            self.assertEqual(len(root_items), 2)  # EmptyFolder и normal_stream

            empty_folder = None
            normal_stream = None
            for item in root_items:
                if item.name == 'EmptyFolder':
                    empty_folder = item
                elif item.name == 'normal_stream':
                    normal_stream = item

            self.assertIsNotNone(empty_folder)
            self.assertIsNotNone(normal_stream)

            # Проверяем, что пустое хранилище действительно пустое
            empty_items = list(empty_folder)
            self.assertEqual(len(empty_items), 0)

            # Проверяем содержимое нормального потока
            with cfr.open(normal_stream) as s:
                content = s.read()
                self.assertEqual(content, b'Normal data')

    def test_maximum_name_length(self):
        """Тест максимальной длины имен"""
        temp_file = os.path.join(self.temp_dir, 'long_names.cfb')
        
        # Имя длиной 31 символ (максимальное для OLE Compound Document)
        long_name = 'A' * 31
        test_data = b'Test data for long name'

        with CompoundFileWriter(temp_file) as writer:
            writer.create_stream(writer.root, long_name, test_data)

        # Проверяем структуру файла
        with CompoundFileReader(temp_file) as cfr:
            root_items = list(cfr.root)
            self.assertEqual(len(root_items), 1)

            stream = root_items[0]
            self.assertEqual(stream.name, long_name)
            self.assertEqual(len(stream.name), 31)

            # Проверяем содержимое
            with cfr.open(stream) as s:
                content = s.read()
                self.assertEqual(content, test_data)

    def test_special_characters_in_names(self):
        """Тест специальных символов в именах"""
        temp_file = os.path.join(self.temp_dir, 'special_chars.cfb')
        
        # Имена с разрешенными символами
        special_names = [
            "name_with_underscore",
            "NameWithCamelCase",
            "name-with-dashes",
            "name.with.dots",
            "name123with456numbers"
        ]
        
        test_data = b'Special character test data'

        with CompoundFileWriter(temp_file) as writer:
            for name in special_names:
                writer.create_stream(writer.root, name, test_data)

        # Проверяем структуру файла
        with CompoundFileReader(temp_file) as cfr:
            root_items = list(cfr.root)
            self.assertEqual(len(root_items), len(special_names))

            for item in root_items:
                self.assertIn(item.name, special_names)
                with cfr.open(item) as s:
                    content = s.read()
                    self.assertEqual(content, test_data)

    def test_zero_size_stream(self):
        """Тест потока нулевого размера"""
        temp_file = os.path.join(self.temp_dir, 'zero_size.cfb')
        
        with CompoundFileWriter(temp_file) as writer:
            writer.create_stream(writer.root, "zero_stream", b'')

        # Проверяем структуру файла
        with CompoundFileReader(temp_file) as cfr:
            root_items = list(cfr.root)
            self.assertEqual(len(root_items), 1)

            stream = root_items[0]
            self.assertEqual(stream.name, 'zero_stream')
            self.assertEqual(stream.size, 0)

            # Проверяем, что содержимое действительно пустое
            with cfr.open(stream) as s:
                content = s.read()
                self.assertEqual(content, b'')