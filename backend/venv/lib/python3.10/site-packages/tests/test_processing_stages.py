"""
Тесты для проверки различных этапов обработки Compound File
"""
import unittest
import os
import tempfile
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from compoundfiles.reader import CompoundFileReader
from compoundfiles.writer import CompoundFileWriter


class TestProcessingStages(unittest.TestCase):
    """Тесты для проверки различных этапов обработки Compound File"""

    def setUp(self):
        """Подготовка тестового окружения"""
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        """Очистка после тестов"""
        # Удаляем временные файлы
        for file in os.listdir(self.temp_dir):
            os.remove(os.path.join(self.temp_dir, file))
        os.rmdir(self.temp_dir)

    def test_initial_empty_file_creation(self):
        """Тест создания пустого файла"""
        temp_file = os.path.join(self.temp_dir, 'empty.cfb')

        # Создаем файл без каких-либо потоков или хранилищ
        with CompoundFileWriter(temp_file) as writer:
            # Только корневой элемент
            pass

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем содержимое
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            # Даже пустой файл должен содержать Root Entry
            # Но в нашей реализации Root Entry не отображается как отдельный элемент
            # Он является контейнером для других элементов

    def test_single_stream_creation(self):
        """Тест создания файла с одним потоком"""
        temp_file = os.path.join(self.temp_dir, 'single_stream.cfb')

        test_data = b'Single stream test data'

        # Создаем файл с одним потоком
        with CompoundFileWriter(temp_file) as writer:
            writer.create_stream(writer.root, "test_stream", test_data)

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем содержимое
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), 1)

            stream = items[0]
            self.assertEqual(stream.name, 'test_stream')
            self.assertTrue(stream.isfile)
            self.assertEqual(stream.size, len(test_data))

            # Проверяем содержимое
            with reader.open(stream) as s:
                content = s.read()
                self.assertEqual(content, test_data)

    def test_single_storage_creation(self):
        """Тест создания файла с одним хранилищем"""
        temp_file = os.path.join(self.temp_dir, 'single_storage.cfb')

        # Создаем файл с одним хранилищем
        with CompoundFileWriter(temp_file) as writer:
            writer.create_storage(writer.root, "test_storage")

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем содержимое
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), 1)

            storage = items[0]
            self.assertEqual(storage.name, 'test_storage')
            self.assertTrue(storage.isdir)

    def test_stream_and_storage_creation(self):
        """Тест создания файла с потоком и хранилищем"""
        temp_file = os.path.join(self.temp_dir, 'stream_and_storage.cfb')

        test_data = b'Stream and storage test data'

        # Создаем файл с потоком и хранилищем
        with CompoundFileWriter(temp_file) as writer:
            writer.create_stream(writer.root, "test_stream", test_data)
            writer.create_storage(writer.root, "test_storage")

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем содержимое
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), 2)

            # Находим поток и хранилище
            stream = None
            storage = None
            for item in items:
                if item.name == 'test_stream':
                    stream = item
                elif item.name == 'test_storage':
                    storage = item

            self.assertIsNotNone(stream)
            self.assertIsNotNone(storage)
            self.assertTrue(stream.isfile)
            self.assertTrue(storage.isdir)

            # Проверяем содержимое потока
            with reader.open(stream) as s:
                content = s.read()
                self.assertEqual(content, test_data)

    def test_nested_storage_creation(self):
        """Тест создания файла с вложенным хранилищем"""
        temp_file = os.path.join(self.temp_dir, 'nested_storage.cfb')

        test_data = b'Nested storage test data'

        # Создаем файл с вложенной структурой
        with CompoundFileWriter(temp_file) as writer:
            parent_storage = writer.create_storage(writer.root, "parent_storage")
            writer.create_stream(parent_storage, "nested_stream", test_data)

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем содержимое
        with CompoundFileReader(temp_file) as reader:
            root_items = list(reader.root)
            self.assertEqual(len(root_items), 1)

            parent_storage = root_items[0]
            self.assertEqual(parent_storage.name, 'parent_storage')
            self.assertTrue(parent_storage.isdir)

            # Проверяем содержимое родительского хранилища
            nested_items = list(parent_storage)
            self.assertEqual(len(nested_items), 1)

            nested_stream = nested_items[0]
            self.assertEqual(nested_stream.name, 'nested_stream')
            self.assertTrue(nested_stream.isfile)
            self.assertEqual(nested_stream.size, len(test_data))

            # Проверяем содержимое вложенного потока
            with reader.open(nested_stream) as s:
                content = s.read()
                self.assertEqual(content, test_data)

    def test_complex_nested_structure(self):
        """Тест создания файла со сложной вложенной структурой"""
        temp_file = os.path.join(self.temp_dir, 'complex_nested.cfb')

        # Создаем сложную вложенную структуру
        with CompoundFileWriter(temp_file) as writer:
            # Уровень 1
            level1_storage = writer.create_storage(writer.root, "level1")
            writer.create_stream(writer.root, "root_stream", b'Root level data')

            # Уровень 2
            level2_storage = writer.create_storage(level1_storage, "level2")
            writer.create_stream(level1_storage, "level1_stream", b'Level 1 data')

            # Уровень 3
            writer.create_stream(level2_storage, "level2_stream", b'Level 2 data')

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем содержимое
        with CompoundFileReader(temp_file) as reader:
            root_items = list(reader.root)
            self.assertEqual(len(root_items), 2)  # root_stream и level1

            # Находим элементы
            root_stream = None
            level1_storage = None
            for item in root_items:
                if item.name == 'root_stream':
                    root_stream = item
                elif item.name == 'level1':
                    level1_storage = item

            self.assertIsNotNone(root_stream)
            self.assertIsNotNone(level1_storage)

            # Проверяем корневой поток
            self.assertTrue(root_stream.isfile)
            with reader.open(root_stream) as s:
                content = s.read()
                self.assertEqual(content, b'Root level data')

            # Проверяем уровень 1
            level1_items = list(level1_storage)
            self.assertEqual(len(level1_items), 2)  # level1_stream и level2

            # Находим элементы уровня 1
            level1_stream = None
            level2_storage = None
            for item in level1_items:
                if item.name == 'level1_stream':
                    level1_stream = item
                elif item.name == 'level2':
                    level2_storage = item

            self.assertIsNotNone(level1_stream)
            self.assertIsNotNone(level2_storage)

            # Проверяем поток уровня 1
            self.assertTrue(level1_stream.isfile)
            with reader.open(level1_stream) as s:
                content = s.read()
                self.assertEqual(content, b'Level 1 data')

            # Проверяем уровень 2
            level2_items = list(level2_storage)
            self.assertEqual(len(level2_items), 1)  # level2_stream

            level2_stream = level2_items[0]
            self.assertEqual(level2_stream.name, 'level2_stream')
            self.assertTrue(level2_stream.isfile)

            # Проверяем поток уровня 2
            with reader.open(level2_stream) as s:
                content = s.read()
                self.assertEqual(content, b'Level 2 data')

    def test_multiple_streams_in_same_storage(self):
        """Тест создания файла с несколькими потоками в одном хранилище"""
        temp_file = os.path.join(self.temp_dir, 'multiple_streams_same_storage.cfb')

        streams_data = {
            'stream1': b'Data for stream 1',
            'stream2': b'Data for stream 2',
            'stream3': b'Data for stream 3'
        }

        # Создаем файл с несколькими потоками в одном хранилище
        with CompoundFileWriter(temp_file) as writer:
            storage = writer.create_storage(writer.root, "container")
            for name, data in streams_data.items():
                writer.create_stream(storage, name, data)

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем содержимое
        with CompoundFileReader(temp_file) as reader:
            root_items = list(reader.root)
            self.assertEqual(len(root_items), 1)

            storage = root_items[0]
            self.assertEqual(storage.name, 'container')
            self.assertTrue(storage.isdir)

            # Проверяем содержимое хранилища
            storage_items = list(storage)
            self.assertEqual(len(storage_items), 3)

            for item in storage_items:
                self.assertIn(item.name, streams_data.keys())
                self.assertTrue(item.isfile)

                # Проверяем содержимое каждого потока
                with reader.open(item) as s:
                    content = s.read()
                    self.assertEqual(content, streams_data[item.name])

    def test_file_modification_simulation(self):
        """Тест эмуляции модификации файла"""
        temp_file = os.path.join(self.temp_dir, 'modification_simulation.cfb')

        # Создаем начальный файл
        with CompoundFileWriter(temp_file) as writer:
            writer.create_stream(writer.root, "initial_stream", b'Initial data')

        # Проверяем начальное состояние
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), 1)

            stream = items[0]
            self.assertEqual(stream.name, 'initial_stream')
            with reader.open(stream) as s:
                content = s.read()
                self.assertEqual(content, b'Initial data')

        # Создаем новый файл с дополнительными данными (симуляция модификации)
        new_temp_file = os.path.join(self.temp_dir, 'modified.cfb')
        with CompoundFileWriter(new_temp_file) as writer:
            writer.create_stream(writer.root, "initial_stream", b'Initial data')
            writer.create_stream(writer.root, "new_stream", b'New data')

        # Проверяем измененное состояние
        with CompoundFileReader(new_temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), 2)

            names = {item.name for item in items}
            self.assertEqual(names, {'initial_stream', 'new_stream'})

            for item in items:
                with reader.open(item) as s:
                    content = s.read()
                    if item.name == 'initial_stream':
                        self.assertEqual(content, b'Initial data')
                    elif item.name == 'new_stream':
                        self.assertEqual(content, b'New data')

    def test_file_with_different_data_types(self):
        """Тест файла с различными типами данных"""
        temp_file = os.path.join(self.temp_dir, 'different_data_types.cfb')

        # Разные типы данных
        text_data = b'Text data for testing'
        binary_data = b'\x00\x01\x02\x03\x04\x05'
        large_text_data = b'Large text data. ' * 1000
        empty_data = b''

        # Создаем файл с различными типами данных
        with CompoundFileWriter(temp_file) as writer:
            writer.create_stream(writer.root, "text_stream", text_data)
            writer.create_stream(writer.root, "binary_stream", binary_data)
            writer.create_stream(writer.root, "large_text_stream", large_text_data)
            writer.create_stream(writer.root, "empty_stream", empty_data)

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем содержимое
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), 4)

            for item in items:
                with reader.open(item) as s:
                    content = s.read()
                    if item.name == 'text_stream':
                        self.assertEqual(content, text_data)
                    elif item.name == 'binary_stream':
                        self.assertEqual(content, binary_data)
                    elif item.name == 'large_text_stream':
                        self.assertEqual(content, large_text_data)
                    elif item.name == 'empty_stream':
                        self.assertEqual(content, empty_data)

    def test_file_with_special_character_names(self):
        """Тест файла с именами, содержащими специальные символы"""
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

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем содержимое
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), len(special_names))

            for item in items:
                self.assertIn(item.name, special_names)
                self.assertTrue(item.isfile)

                # Проверяем содержимое
                with reader.open(item) as s:
                    content = s.read()
                    self.assertEqual(content, test_data)