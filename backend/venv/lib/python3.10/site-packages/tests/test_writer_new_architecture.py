"""
Тесты для новой архитектуры Writer
"""
import unittest
import os
import tempfile
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from compoundfiles.reader import CompoundFileReader
from compoundfiles.writer import CompoundFileWriter


class TestWriterNewArchitecture(unittest.TestCase):
    """Тесты для новой архитектуры Writer"""

    def setUp(self):
        """Подготовка тестового окружения"""
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        """Очистка после тестов"""
        # Удаляем временные файлы
        for file in os.listdir(self.temp_dir):
            os.remove(os.path.join(self.temp_dir, file))
        os.rmdir(self.temp_dir)

    def test_basic_stream_creation(self):
        """Тест базового создания потока"""
        temp_file = os.path.join(self.temp_dir, 'basic_stream.cfb')

        test_data = b'Basic stream test data'

        # Создаем файл с одним потоком
        with CompoundFileWriter(temp_file) as writer:
            writer.create_stream(writer.root, "basic_stream", test_data)

        # Проверяем результат
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), 1)

            stream = items[0]
            self.assertEqual(stream.name, 'basic_stream')
            self.assertTrue(stream.isfile)
            self.assertEqual(stream.size, len(test_data))

            with reader.open(stream) as s:
                content = s.read()
                self.assertEqual(content, test_data)

    def test_basic_storage_creation(self):
        """Тест базового создания хранилища"""
        temp_file = os.path.join(self.temp_dir, 'basic_storage.cfb')

        # Создаем файл с одним хранилищем
        with CompoundFileWriter(temp_file) as writer:
            writer.create_storage(writer.root, "basic_storage")

        # Проверяем результат
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), 1)

            storage = items[0]
            self.assertEqual(storage.name, 'basic_storage')
            self.assertTrue(storage.isdir)

    def test_nested_structure_creation(self):
        """Тест создания вложенной структуры"""
        temp_file = os.path.join(self.temp_dir, 'nested_structure.cfb')

        # Создаем вложенную структуру
        with CompoundFileWriter(temp_file) as writer:
            level1 = writer.create_storage(writer.root, "level1")
            level2 = writer.create_storage(level1, "level2")
            writer.create_stream(level2, "deep_stream", b'Deep nested data')

        # Проверяем структуру
        with CompoundFileReader(temp_file) as reader:
            # Проверяем корневой уровень
            root_items = list(reader.root)
            self.assertEqual(len(root_items), 1)

            level1_item = root_items[0]
            self.assertEqual(level1_item.name, 'level1')
            self.assertTrue(level1_item.isdir)

            # Проверяем уровень 1
            level1_items = list(level1_item)
            self.assertEqual(len(level1_items), 1)

            level2_item = level1_items[0]
            self.assertEqual(level2_item.name, 'level2')
            self.assertTrue(level2_item.isdir)

            # Проверяем уровень 2
            level2_items = list(level2_item)
            self.assertEqual(len(level2_items), 1)

            deep_stream = level2_items[0]
            self.assertEqual(deep_stream.name, 'deep_stream')
            self.assertTrue(deep_stream.isfile)

            # Проверяем содержимое
            with reader.open(deep_stream) as s:
                content = s.read()
                self.assertEqual(content, b'Deep nested data')

    def test_multiple_streams_in_root(self):
        """Тест нескольких потоков в корне"""
        temp_file = os.path.join(self.temp_dir, 'multiple_streams_root.cfb')

        streams_data = {
            'stream1': b'Data for stream 1',
            'stream2': b'Data for stream 2',
            'stream3': b'Data for stream 3'
        }

        # Создаем файл с несколькими потоками в корне
        with CompoundFileWriter(temp_file) as writer:
            for name, data in streams_data.items():
                writer.create_stream(writer.root, name, data)

        # Проверяем результат
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), 3)

            for item in items:
                self.assertIn(item.name, streams_data.keys())
                self.assertTrue(item.isfile)

                with reader.open(item) as s:
                    content = s.read()
                    self.assertEqual(content, streams_data[item.name])

    def test_multiple_storages_in_root(self):
        """Тест нескольких хранилищ в корне"""
        temp_file = os.path.join(self.temp_dir, 'multiple_storages_root.cfb')

        storage_names = ['storage1', 'storage2', 'storage3']

        # Создаем файл с несколькими хранилищами в корне
        with CompoundFileWriter(temp_file) as writer:
            for name in storage_names:
                writer.create_storage(writer.root, name)

        # Проверяем результат
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), 3)

            for item in items:
                self.assertIn(item.name, storage_names)
                self.assertTrue(item.isdir)

    def test_complex_mixed_structure(self):
        """Тест сложной смешанной структуры"""
        temp_file = os.path.join(self.temp_dir, 'complex_mixed.cfb')

        # Создаем сложную смешанную структуру
        with CompoundFileWriter(temp_file) as writer:
            # Создаем потоки и хранилища в корне
            writer.create_stream(writer.root, "root_stream", b'Root data')
            storage1 = writer.create_storage(writer.root, "storage1")
            storage2 = writer.create_storage(writer.root, "storage2")

            # Добавляем содержимое в storage1
            writer.create_stream(storage1, "s1_stream1", b'Storage 1 data 1')
            writer.create_stream(storage1, "s1_stream2", b'Storage 1 data 2')

            # Добавляем содержимое в storage2
            storage2_1 = writer.create_storage(storage2, "storage2_1")
            writer.create_stream(storage2, "s2_stream", b'Storage 2 data')

            # Добавляем содержимое в storage2_1
            writer.create_stream(storage2_1, "s2_1_stream", b'Storage 2-1 data')

        # Проверяем структуру
        with CompoundFileReader(temp_file) as reader:
            root_items = list(reader.root)
            self.assertEqual(len(root_items), 3)  # root_stream, storage1, storage2

            # Находим элементы
            root_stream = None
            root_storage1 = None
            root_storage2 = None
            for item in root_items:
                if item.name == 'root_stream':
                    root_stream = item
                elif item.name == 'storage1':
                    root_storage1 = item
                elif item.name == 'storage2':
                    root_storage2 = item

            self.assertIsNotNone(root_stream)
            self.assertIsNotNone(root_storage1)
            self.assertIsNotNone(root_storage2)

            # Проверяем корневой поток
            self.assertTrue(root_stream.isfile)
            with reader.open(root_stream) as s:
                content = s.read()
                self.assertEqual(content, b'Root data')

            # Проверяем storage1
            self.assertTrue(root_storage1.isdir)
            s1_items = list(root_storage1)
            self.assertEqual(len(s1_items), 2)  # s1_stream1, s1_stream2

            s1_stream_names = {item.name for item in s1_items}
            self.assertEqual(s1_stream_names, {'s1_stream1', 's1_stream2'})

            for item in s1_items:
                with reader.open(item) as s:
                    if item.name == 's1_stream1':
                        self.assertEqual(s.read(), b'Storage 1 data 1')
                    elif item.name == 's1_stream2':
                        self.assertEqual(s.read(), b'Storage 1 data 2')

            # Проверяем storage2
            self.assertTrue(root_storage2.isdir)
            s2_items = list(root_storage2)
            self.assertEqual(len(s2_items), 2)  # storage2_1, s2_stream

            s2_storage2_1 = None
            s2_s2_stream = None
            for item in s2_items:
                if item.name == 'storage2_1':
                    s2_storage2_1 = item
                elif item.name == 's2_stream':
                    s2_s2_stream = item

            self.assertIsNotNone(s2_storage2_1)
            self.assertIsNotNone(s2_s2_stream)

            # Проверяем s2_stream
            self.assertTrue(s2_s2_stream.isfile)
            with reader.open(s2_s2_stream) as s:
                content = s.read()
                self.assertEqual(content, b'Storage 2 data')

            # Проверяем storage2_1
            self.assertTrue(s2_storage2_1.isdir)
            s2_1_items = list(s2_storage2_1)
            self.assertEqual(len(s2_1_items), 1)  # s2_1_stream

            s2_1_stream = s2_1_items[0]
            self.assertEqual(s2_1_stream.name, 's2_1_stream')
            self.assertTrue(s2_1_stream.isfile)

            with reader.open(s2_1_stream) as s:
                content = s.read()
                self.assertEqual(content, b'Storage 2-1 data')

    def test_large_data_handling(self):
        """Тест обработки больших данных"""
        temp_file = os.path.join(self.temp_dir, 'large_data.cfb')

        # Создаем большие данные
        large_data = b'L' * (50 * 1024)  # 50KB

        # Создаем файл с большим потоком
        with CompoundFileWriter(temp_file) as writer:
            writer.create_stream(writer.root, "large_stream", large_data)

        # Проверяем результат
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), 1)

            stream = items[0]
            self.assertEqual(stream.name, 'large_stream')
            self.assertTrue(stream.isfile)
            self.assertEqual(stream.size, len(large_data))

            with reader.open(stream) as s:
                content = s.read()
                self.assertEqual(content, large_data)

    def test_empty_stream_handling(self):
        """Тест обработки пустых потоков"""
        temp_file = os.path.join(self.temp_dir, 'empty_stream.cfb')

        # Создаем файл с пустым потоком
        with CompoundFileWriter(temp_file) as writer:
            writer.create_stream(writer.root, "empty_stream", b'')

        # Проверяем результат
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), 1)

            stream = items[0]
            self.assertEqual(stream.name, 'empty_stream')
            self.assertTrue(stream.isfile)
            self.assertEqual(stream.size, 0)

            with reader.open(stream) as s:
                content = s.read()
                self.assertEqual(content, b'')

    def test_special_character_names(self):
        """Тест имен с особыми символами"""
        temp_file = os.path.join(self.temp_dir, 'special_names.cfb')

        # Имена с разрешенными символами
        special_names = [
            "name_with_underscore",
            "NameWithCamelCase",
            "name-with-dashes",
            "name.with.dots",
            "name123with456numbers"
        ]
        
        test_data = b'Special character test data'

        # Создаем файл с именами, содержащими специальные символы
        with CompoundFileWriter(temp_file) as writer:
            for name in special_names:
                writer.create_stream(writer.root, name, test_data)

        # Проверяем результат
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), len(special_names))

            for item in items:
                self.assertIn(item.name, special_names)
                self.assertTrue(item.isfile)

                with reader.open(item) as s:
                    content = s.read()
                    self.assertEqual(content, test_data)

    def test_file_like_object_writing(self):
        """Тест записи в file-like объект"""
        import io

        # Создаем BytesIO объект
        bio = io.BytesIO()

        test_data = b'File-like object test data'

        # Создаем файл в BytesIO
        with CompoundFileWriter(bio) as writer:
            writer.create_stream(writer.root, "file_like_stream", test_data)

        # Получаем байты
        file_bytes = bio.getvalue()

        # Сохраняем в настоящий файл для проверки
        temp_file = os.path.join(self.temp_dir, 'file_like.cfb')
        with open(temp_file, 'wb') as f:
            f.write(file_bytes)

        # Проверяем результат
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), 1)

            stream = items[0]
            self.assertEqual(stream.name, 'file_like_stream')
            self.assertTrue(stream.isfile)

            with reader.open(stream) as s:
                content = s.read()
                self.assertEqual(content, test_data)