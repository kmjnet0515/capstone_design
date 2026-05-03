"""
Тесты для проверки работы с большими FAT таблицами
"""
import unittest
import os
import tempfile
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from compoundfiles.reader import CompoundFileReader
from compoundfiles.writer import CompoundFileWriter


class TestLargeFat(unittest.TestCase):
    """Тесты для проверки работы с большими FAT таблицами"""

    def setUp(self):
        """Подготовка тестового окружения"""
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        """Очистка после тестов"""
        # Удаляем временные файлы
        for file in os.listdir(self.temp_dir):
            os.remove(os.path.join(self.temp_dir, file))
        os.rmdir(self.temp_dir)

    def test_medium_size_file(self):
        """Тест файла среднего размера, требующего нескольких секторов"""
        temp_file = os.path.join(self.temp_dir, 'medium_file.cfb')

        # Создаем данные, которые займут несколько секторов (например, 5KB)
        medium_data = b'Medium size data. ' * 256  # Примерно 5KB

        # Создаем файл с помощью CompoundFileWriter
        with CompoundFileWriter(temp_file) as writer:
            writer.create_stream(writer.root, "medium_stream", medium_data)

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем содержимое
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), 1)

            stream = items[0]
            self.assertEqual(stream.name, 'medium_stream')
            self.assertEqual(stream.size, len(medium_data))

            # Проверяем содержимое
            with reader.open(stream) as s:
                content = s.read()
                self.assertEqual(content, medium_data)

    def test_large_file_with_multiple_streams(self):
        """Тест большого файла с несколькими потоками"""
        temp_file = os.path.join(self.temp_dir, 'large_multi_stream.cfb')

        # Создаем несколько потоков с данными, занимающими много секторов
        streams_data = {
            'stream_1': b'A' * 10000,  # 10KB
            'stream_2': b'B' * 15000,  # 15KB
            'stream_3': b'C' * 8000,   # 8KB
        }

        # Создаем файл с помощью CompoundFileWriter
        with CompoundFileWriter(temp_file) as writer:
            for name, data in streams_data.items():
                writer.create_stream(writer.root, name, data)

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем содержимое
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), 3)

            for item in items:
                self.assertIn(item.name, streams_data.keys())
                self.assertEqual(item.size, len(streams_data[item.name]))

                # Проверяем содержимое каждого потока
                with reader.open(item) as s:
                    content = s.read()
                    self.assertEqual(content, streams_data[item.name])

    def test_file_with_many_small_streams(self):
        """Тест файла с большим количеством маленьких потоков"""
        temp_file = os.path.join(self.temp_dir, 'many_small_streams.cfb')

        # Создаем много маленьких потоков
        num_streams = 200
        stream_data = b'Small data'

        # Создаем файл с помощью CompoundFileWriter
        with CompoundFileWriter(temp_file) as writer:
            for i in range(num_streams):
                writer.create_stream(writer.root, f'stream_{i:03d}', stream_data)

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем содержимое
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), num_streams)

            for i, item in enumerate(items):
                expected_name = f'stream_{i:03d}'
                self.assertEqual(item.name, expected_name)
                self.assertEqual(item.size, len(stream_data))

                # Проверяем содержимое каждого потока
                with reader.open(item) as s:
                    content = s.read()
                    self.assertEqual(content, stream_data)

    def test_file_with_nested_storages_and_streams(self):
        """Тест файла с вложенными хранилищами и большим количеством потоков"""
        temp_file = os.path.join(self.temp_dir, 'nested_storages.cfb')

        # Создаем вложенную структуру с потоками
        with CompoundFileWriter(temp_file) as writer:
            # Создаем основное хранилище
            main_storage = writer.create_storage(writer.root, "MainStorage")

            # Создаем подхранилища
            sub_storage_1 = writer.create_storage(main_storage, "SubStorage1")
            sub_storage_2 = writer.create_storage(main_storage, "SubStorage2")

            # Добавляем потоки в корень
            writer.create_stream(writer.root, "root_stream_1", b'Root data 1')
            writer.create_stream(writer.root, "root_stream_2", b'Root data 2')

            # Добавляем потоки в основное хранилище
            writer.create_stream(main_storage, "main_stream_1", b'Main data 1')
            writer.create_stream(main_storage, "main_stream_2", b'Main data 2')

            # Добавляем много потоков в подхранилища
            for i in range(50):
                writer.create_stream(sub_storage_1, f'ss1_stream_{i:02d}', f'SubStorage1 data {i}'.encode())
                writer.create_stream(sub_storage_2, f'ss2_stream_{i:02d}', f'SubStorage2 data {i}'.encode())

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем структуру
        with CompoundFileReader(temp_file) as reader:
            root_items = list(reader.root)

            # Подсчитываем количество хранилищ и потоков
            root_storages = [item for item in root_items if item.isdir]
            root_streams = [item for item in root_items if item.isfile]

            self.assertEqual(len(root_storages), 1)  # MainStorage
            self.assertEqual(len(root_streams), 2)  # root_stream_1, root_stream_2

            # Находим элементы
            main_storage = root_storages[0]
            self.assertEqual(main_storage.name, 'MainStorage')

            # Проверяем корневые потоки
            root_stream_names = {item.name for item in root_streams}
            self.assertEqual(root_stream_names, {'root_stream_1', 'root_stream_2'})

            for item in root_streams:
                with reader.open(item) as s:
                    if item.name == 'root_stream_1':
                        self.assertEqual(s.read(), b'Root data 1')
                    elif item.name == 'root_stream_2':
                        self.assertEqual(s.read(), b'Root data 2')

            # Проверяем основное хранилище
            main_items = list(main_storage)

            # Подсчитываем количество хранилищ и потоков в основном хранилище
            main_sub_storages = [item for item in main_items if item.isdir]
            main_streams = [item for item in main_items if item.isfile]

            self.assertEqual(len(main_sub_storages), 2)  # SubStorage1, SubStorage2
            self.assertEqual(len(main_streams), 2)  # main_stream_1, main_stream_2

            # Проверяем потоки в основном хранилище
            main_stream_names = {item.name for item in main_streams}
            self.assertEqual(main_stream_names, {'main_stream_1', 'main_stream_2'})

            for item in main_streams:
                with reader.open(item) as s:
                    if item.name == 'main_stream_1':
                        self.assertEqual(s.read(), b'Main data 1')
                    elif item.name == 'main_stream_2':
                        self.assertEqual(s.read(), b'Main data 2')

            # Проверяем подхранилища
            sub_storage_names = {item.name for item in main_sub_storages}
            self.assertEqual(sub_storage_names, {'SubStorage1', 'SubStorage2'})

            for storage in main_sub_storages:
                sub_items = list(storage)
                self.assertEqual(len(sub_items), 50)  # по 50 потоков в каждом

                # Создаем множество ожидаемых имен для проверки
                expected_names = set()
                expected_contents = {}

                # Определяем префикс на основе имени хранилища
                if storage.name == "SubStorage1":
                    prefix = "ss1"
                elif storage.name == "SubStorage2":
                    prefix = "ss2"
                else:
                    # Если ни один из ожидаемых, используем общий подход
                    prefix = storage.name.lower()[:3]  # Берем первые 3 символа

                for i in range(50):
                    expected_name = f'{prefix}_stream_{i:02d}'  # ss1 или ss2
                    expected_names.add(expected_name)
                    expected_contents[expected_name] = f'{storage.name} data {i}'.encode()

                # Проверяем, что все потоки имеют правильные имена и содержимое
                actual_names = {item.name for item in sub_items}
                self.assertEqual(actual_names, expected_names)

                # Проверяем содержимое каждого потока
                for item in sub_items:
                    self.assertIn(item.name, expected_contents)
                    with reader.open(item) as s:
                        self.assertEqual(s.read(), expected_contents[item.name])

    def test_file_with_large_single_stream(self):
        """Тест файла с одним большим потоком"""
        temp_file = os.path.join(self.temp_dir, 'large_single_stream.cfb')

        # Создаем один большой поток (100KB)
        large_data = b'L' * (100 * 1024)  # 100KB

        # Создаем файл с помощью CompoundFileWriter
        with CompoundFileWriter(temp_file) as writer:
            writer.create_stream(writer.root, "large_stream", large_data)

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем содержимое
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), 1)

            stream = items[0]
            self.assertEqual(stream.name, 'large_stream')
            self.assertEqual(stream.size, len(large_data))

            # Проверяем содержимое (читаем частями для эффективности)
            with reader.open(stream) as s:
                content = s.read()
                self.assertEqual(content, large_data)

    def test_file_with_various_size_streams(self):
        """Тест файла с потоками различных размеров"""
        temp_file = os.path.join(self.temp_dir, 'various_sizes.cfb')

        # Создаем потоки различных размеров
        streams_spec = [
            ('tiny_stream', b'T'),  # 1 байт
            ('small_stream', b'S' * 100),  # 100 байт
            ('medium_stream', b'M' * 10000),  # 10KB
            ('large_stream', b'L' * 50000),  # 50KB
            ('huge_stream', b'H' * 1000),  # 1KB
        ]

        # Создаем файл с помощью CompoundFileWriter
        with CompoundFileWriter(temp_file) as writer:
            for name, data in streams_spec:
                writer.create_stream(writer.root, name, data)

        # Проверяем, что файл был создан
        self.assertTrue(os.path.exists(temp_file))

        # Проверяем содержимое
        with CompoundFileReader(temp_file) as reader:
            items = list(reader.root)
            self.assertEqual(len(items), len(streams_spec))

            # Создаем словарь для проверки
            items_dict = {item.name: item for item in items}

            # Проверяем каждый поток
            for expected_name, expected_data in streams_spec:
                self.assertIn(expected_name, items_dict)

                item = items_dict[expected_name]
                self.assertEqual(item.size, len(expected_data))

                # Проверяем содержимое
                with reader.open(item) as s:
                    content = s.read()
                    self.assertEqual(content, expected_data)