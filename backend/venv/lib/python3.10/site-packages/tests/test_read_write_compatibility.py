"""
Тесты для проверки совместимости между чтением и записью файлов Compound File
"""
import unittest
import os
import tempfile
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from compoundfiles.reader import CompoundFileReader
from compoundfiles.writer import CompoundFileWriter


class TestReadWriteCompatibility(unittest.TestCase):
    """Тесты для проверки совместимости между чтением и записью"""

    def setUp(self):
        """Подготовка тестового окружения"""
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        """Очистка после тестов"""
        # Удаляем временные файлы
        for file in os.listdir(self.temp_dir):
            os.remove(os.path.join(self.temp_dir, file))
        os.rmdir(self.temp_dir)

    def test_round_trip_simple(self):
        """Тест простого цикла чтение-запись-чтение"""
        # Создаем файл с помощью CompoundFileWriter
        original_file = os.path.join(self.temp_dir, 'original.cfb')
        test_data = b'Original data'
        
        with CompoundFileWriter(original_file) as writer:
            writer.create_stream(writer.root, "test_stream", test_data)

        # Читаем исходный файл
        with CompoundFileReader(original_file) as original_cfr:
            items = list(original_cfr.root)
            self.assertEqual(len(items), 1)
            
            original_stream = items[0]
            self.assertEqual(original_stream.name, 'test_stream')
            
            with original_cfr.open(original_stream) as s:
                original_data = s.read()

        # Создаем новый файл с теми же данными
        new_file = os.path.join(self.temp_dir, 'new.cfb')
        with CompoundFileWriter(new_file) as writer:
            writer.create_stream(writer.root, "copied_stream", original_data)

        # Проверяем, что новый файл может быть прочитан
        with CompoundFileReader(new_file) as new_cfr:
            items = list(new_cfr.root)
            self.assertEqual(len(items), 1)
            
            new_stream = items[0]
            self.assertEqual(new_stream.name, 'copied_stream')
            
            with new_cfr.open(new_stream) as s:
                new_data = s.read()

        # Проверяем, что данные совпадают
        self.assertEqual(original_data, new_data)

    def test_round_trip_with_storages(self):
        """Тест цикла чтение-запись с хранилищами"""
        # Создаем файл с хранилищами
        original_file = os.path.join(self.temp_dir, 'original_with_storages.cfb')
        
        with CompoundFileWriter(original_file) as writer:
            folder1 = writer.create_storage(writer.root, "folder1")
            writer.create_stream(folder1, "file1", b'File 1 content')
            writer.create_stream(writer.root, "root_file", b'Root file content')

        # Читаем файл и проверяем структуру
        with CompoundFileReader(original_file) as original_cfr:
            # Проверяем корневые элементы
            root_items = list(original_cfr.root)
            self.assertEqual(len(root_items), 2)  # folder1 и root_file

            # Находим элементы
            folder1 = None
            root_file = None
            for item in root_items:
                if item.name == 'folder1':
                    folder1 = item
                elif item.name == 'root_file':
                    root_file = item

            self.assertIsNotNone(folder1)
            self.assertIsNotNone(root_file)

            # Проверяем содержимое корневого файла
            with original_cfr.open(root_file) as s:
                root_content = s.read()
            self.assertEqual(root_content, b'Root file content')

            # Проверяем содержимое файла в папке
            folder_items = list(folder1)
            self.assertEqual(len(folder_items), 1)
            file1 = folder_items[0]
            with original_cfr.open(file1) as s:
                file1_content = s.read()
            self.assertEqual(file1_content, b'File 1 content')

    def test_multiple_streams_round_trip(self):
        """Тест цикла чтение-запись с несколькими потоками"""
        # Создаем файл с несколькими потоками
        original_file = os.path.join(self.temp_dir, 'multiple_streams.cfb')
        streams_data = {
            'stream1': b'Data for stream 1',
            'stream2': b'Data for stream 2',
            'stream3': b'Data for stream 3'
        }

        with CompoundFileWriter(original_file) as writer:
            for name, data in streams_data.items():
                writer.create_stream(writer.root, name, data)

        # Читаем файл и проверяем все потоки
        with CompoundFileReader(original_file) as cfr:
            items = list(cfr.root)
            self.assertEqual(len(items), 3)

            for item in items:
                self.assertIn(item.name, streams_data.keys())
                with cfr.open(item) as s:
                    content = s.read()
                    self.assertEqual(content, streams_data[item.name])

    def test_large_data_round_trip(self):
        """Тест цикла чтение-запись с большими данными"""
        # Создаем большие данные
        large_data = b'Large data content. ' * 1000  # ~20KB

        # Создаем файл
        original_file = os.path.join(self.temp_dir, 'large_data.cfb')
        with CompoundFileWriter(original_file) as writer:
            writer.create_stream(writer.root, "large_stream", large_data)

        # Читаем файл и проверяем данные
        with CompoundFileReader(original_file) as cfr:
            items = list(cfr.root)
            self.assertEqual(len(items), 1)

            stream = items[0]
            self.assertEqual(stream.name, 'large_stream')
            self.assertEqual(stream.size, len(large_data))

            with cfr.open(stream) as s:
                content = s.read()
                self.assertEqual(content, large_data)

    def test_empty_stream_round_trip(self):
        """Тест цикла чтение-запись с пустым потоком"""
        # Создаем файл с пустым потоком
        original_file = os.path.join(self.temp_dir, 'empty_stream.cfb')
        with CompoundFileWriter(original_file) as writer:
            writer.create_stream(writer.root, "empty_stream", b'')

        # Читаем файл и проверяем пустой поток
        with CompoundFileReader(original_file) as cfr:
            items = list(cfr.root)
            self.assertEqual(len(items), 1)

            stream = items[0]
            self.assertEqual(stream.name, 'empty_stream')
            self.assertEqual(stream.size, 0)

            with cfr.open(stream) as s:
                content = s.read()
                self.assertEqual(content, b'')

    def test_nested_storages_round_trip(self):
        """Тест цикла чтение-запись с вложенными хранилищами"""
        # Создаем файл с вложенными хранилищами
        original_file = os.path.join(self.temp_dir, 'nested_storages.cfb')
        with CompoundFileWriter(original_file) as writer:
            level1 = writer.create_storage(writer.root, "level1")
            level2 = writer.create_storage(level1, "level2")
            writer.create_stream(level2, "deep_stream", b'Deep nested content')

        # Читаем файл и проверяем структуру
        with CompoundFileReader(original_file) as cfr:
            # Проверяем корневой уровень
            root_items = list(cfr.root)
            self.assertEqual(len(root_items), 1)

            level1 = root_items[0]
            self.assertEqual(level1.name, 'level1')
            self.assertTrue(level1.isdir)

            # Проверяем уровень 1
            level1_items = list(level1)
            self.assertEqual(len(level1_items), 1)

            level2 = level1_items[0]
            self.assertEqual(level2.name, 'level2')
            self.assertTrue(level2.isdir)

            # Проверяем уровень 2
            level2_items = list(level2)
            self.assertEqual(len(level2_items), 1)

            deep_stream = level2_items[0]
            self.assertEqual(deep_stream.name, 'deep_stream')
            self.assertTrue(deep_stream.isfile)

            # Проверяем содержимое
            with cfr.open(deep_stream) as s:
                content = s.read()
                self.assertEqual(content, b'Deep nested content')

    def test_special_characters_in_names(self):
        """Тест имен с особыми символами"""
        # Создаем файл с особыми символами в именах
        original_file = os.path.join(self.temp_dir, 'special_names.cfb')
        with CompoundFileWriter(original_file) as writer:
            writer.create_stream(writer.root, "normal_name", b'Normal content')
            writer.create_stream(writer.root, "name_with_underscore", b'Underscore content')
            writer.create_stream(writer.root, "NameWithCamelCase", b'CamelCase content')

        # Читаем файл и проверяем имена
        with CompoundFileReader(original_file) as cfr:
            items = list(cfr.root)
            self.assertEqual(len(items), 3)

            names_found = set()
            contents_found = set()
            for item in items:
                names_found.add(item.name)
                with cfr.open(item) as s:
                    contents_found.add(s.read())

            expected_names = {'normal_name', 'name_with_underscore', 'NameWithCamelCase'}
            expected_contents = {b'Normal content', b'Underscore content', b'CamelCase content'}

            self.assertEqual(names_found, expected_names)
            self.assertEqual(contents_found, expected_contents)

    def test_stream_sizes(self):
        """Тест различных размеров потоков"""
        # Создаем файл с потоками разных размеров
        original_file = os.path.join(self.temp_dir, 'various_sizes.cfb')
        with CompoundFileWriter(original_file) as writer:
            # Очень маленький поток
            writer.create_stream(writer.root, "tiny_stream", b'A')

            # Поток размером в сектор
            sector_data = b'X' * 512
            writer.create_stream(writer.root, "sector_stream", sector_data)

            # Поток чуть больше сектора
            slightly_more = b'Y' * 513
            writer.create_stream(writer.root, "slightly_more_stream", slightly_more)

            # Большой поток
            large_data = b'Z' * 10000
            writer.create_stream(writer.root, "large_stream", large_data)

        # Читаем файл и проверяем размеры
        with CompoundFileReader(original_file) as cfr:
            items = list(cfr.root)
            self.assertEqual(len(items), 4)

            for item in items:
                if item.name == 'tiny_stream':
                    self.assertEqual(item.size, 1)
                    with cfr.open(item) as s:
                        self.assertEqual(s.read(), b'A')
                elif item.name == 'sector_stream':
                    self.assertEqual(item.size, 512)
                    with cfr.open(item) as s:
                        self.assertEqual(s.read(), sector_data)
                elif item.name == 'slightly_more_stream':
                    self.assertEqual(item.size, 513)
                    with cfr.open(item) as s:
                        self.assertEqual(s.read(), slightly_more)
                elif item.name == 'large_stream':
                    self.assertEqual(item.size, 10000)
                    with cfr.open(item) as s:
                        self.assertEqual(s.read(), large_data)