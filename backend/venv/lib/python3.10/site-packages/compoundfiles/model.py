"""
Модель OLE Compound Document - представление структуры файла в памяти
"""
from typing import Dict, List, Optional, Union
from enum import Enum
import struct
from datetime import datetime


class OleNodeType(Enum):
    """Тип узла в OLE Compound Document"""
    STORAGE = 1
    STREAM = 2
    ROOT = 3


class OleNode:
    """Представление узла (хранилища или потока) в OLE Compound Document"""
    
    def __init__(self, name: str, node_type: OleNodeType, parent: Optional['OleNode'] = None):
        self.name = name
        self.type = node_type
        self.parent = parent
        self.children: Dict[str, 'OleNode'] = {}
        self.data: Optional[bytes] = None
        self.size: int = 0
        self.start_sector: int = -1  # Логический номер сектора
        self.created: Optional[datetime] = None
        self.modified: Optional[datetime] = None
        # Для потоков
        self.sector_chain: List[int] = []  # Цепочка секторов для нормальных потоков
        self.mini_sector_chain: List[int] = []  # Цепочка секторов для мини-потоков
    
    def add_child(self, child: 'OleNode'):
        """Добавить дочерний узел"""
        child.parent = self
        self.children[child.name] = child
    
    def remove_child(self, name: str):
        """Удалить дочерний узел"""
        if name in self.children:
            del self.children[name]
    
    def get_child(self, name: str) -> Optional['OleNode']:
        """Получить дочерний узел"""
        return self.children.get(name)
    
    def set_data(self, data: bytes):
        """Установить данные для потока"""
        self.data = data
        self.size = len(data)
    
    def is_small_stream(self) -> bool:
        """Проверить, является ли поток маленьким (меньше 4096 байт)"""
        return self.type == OleNodeType.STREAM and self.size < 4096


class OleModel:
    """Модель OLE Compound Document - представление структуры файла в памяти"""
    
    def __init__(self):
        # Корневой узел
        self.root = OleNode("Root Entry", OleNodeType.ROOT)
        # Все узлы в плоском виде для удобства доступа
        self.all_nodes: Dict[str, OleNode] = {"Root Entry": self.root}
        # Пути к узлам
        self.node_paths: Dict[str, OleNode] = {"/": self.root}
    
    def add_storage(self, path: str, name: str) -> OleNode:
        """Добавить хранилище по пути"""
        parent_node = self._get_node_by_path(path)
        if not parent_node:
            raise ValueError(f"Parent path {path} does not exist")
        
        if parent_node.type not in (OleNodeType.STORAGE, OleNodeType.ROOT):
            raise ValueError(f"Parent {path} is not a storage or root")
        
        new_storage = OleNode(name, OleNodeType.STORAGE)
        parent_node.add_child(new_storage)
        
        # Сохраняем в плоские структуры
        full_path = f"{path}/{name}" if path != "/" else f"/{name}"
        self.all_nodes[name] = new_storage
        self.node_paths[full_path] = new_storage
        
        return new_storage
    
    def add_stream(self, path: str, name: str, data: bytes = b'') -> OleNode:
        """Добавить поток по пути"""
        parent_node = self._get_node_by_path(path)
        if not parent_node:
            raise ValueError(f"Parent path {path} does not exist")
        
        if parent_node.type not in (OleNodeType.STORAGE, OleNodeType.ROOT):
            raise ValueError(f"Parent {path} is not a storage or root")
        
        new_stream = OleNode(name, OleNodeType.STREAM)
        new_stream.set_data(data)
        parent_node.add_child(new_stream)
        
        # Сохраняем в плоские структуры
        full_path = f"{path}/{name}" if path != "/" else f"/{name}"
        self.all_nodes[name] = new_stream
        self.node_paths[full_path] = new_stream
        
        return new_stream
    
    def _get_node_by_path(self, path: str) -> Optional[OleNode]:
        """Получить узел по пути"""
        if path == "/":
            return self.root
        
        # Убираем начальный и конечный слэши
        path_parts = [part for part in path.strip('/').split('/') if part]
        
        current_node = self.root
        for part in path_parts:
            current_node = current_node.get_child(part)
            if not current_node:
                return None
        
        return current_node
    
    def get_node_by_path(self, path: str) -> Optional[OleNode]:
        """Получить узел по пути"""
        return self._get_node_by_path(path)
    
    def get_stream_data(self, path: str) -> Optional[bytes]:
        """Получить данные потока по пути"""
        node = self._get_node_by_path(path)
        if node and node.type == OleNodeType.STREAM:
            return node.data
        return None
    
    def set_stream_data(self, path: str, data: bytes):
        """Установить данные потока по пути"""
        node = self._get_node_by_path(path)
        if node and node.type == OleNodeType.STREAM:
            node.set_data(data)
        else:
            raise ValueError(f"No stream found at path {path}")
    
    def list_children(self, path: str = "/") -> List[str]:
        """Получить список имен дочерних узлов"""
        node = self._get_node_by_path(path)
        if node:
            return list(node.children.keys())
        return []
    
    def get_node_info(self, path: str) -> Optional[dict]:
        """Получить информацию об узле"""
        node = self._get_node_by_path(path)
        if node:
            return {
                'name': node.name,
                'type': node.type,
                'size': node.size,
                'is_small_stream': node.is_small_stream(),
                'has_children': len(node.children) > 0
            }
        return None


class OleLayoutResult:
    """Результат построения размещения секторов"""
    
    def __init__(self):
        # Сектора для FAT
        self.fat_sectors: List[int] = []
        # Сектора для DIFAT
        self.difat_sectors: List[int] = []
        # Сектора для директории
        self.directory_sectors: List[int] = []
        # Сектора для MiniFAT
        self.minifat_sectors: List[int] = []
        # Сектора для данных мини-потоков
        self.mini_stream_sectors: List[int] = []
        # Сектора для обычных потоков
        self.normal_stream_sectors: Dict[str, List[int]] = {}  # path -> list of sectors
        
        # FAT массив
        self.fat_array: List[int] = []
        # MiniFAT массив
        self.minifat_array: List[int] = []
        
        # Информация о секторах
        self.total_sectors: int = 0
        self.sector_size: int = 512
        self.mini_sector_size: int = 64


def from_model(model: OleModel) -> OleLayoutResult:
    """
    Создать OleLayoutResult из OleModel
    Это будет основной функцией преобразования модели в размещение секторов
    """
    builder = OleLayoutBuilder()
    return builder.build(model)


class OleLayoutBuilder:
    """Построитель размещения секторов для OLE Compound Document"""
    
    def __init__(self):
        self.mini_size_limit = 4096  # Порог для мини-потоков
        self.sector_size = 512
        self.mini_sector_size = 64
    
    def build(self, model: OleModel) -> OleLayoutResult:
        """Построить размещение секторов для модели"""
        result = OleLayoutResult()
        result.sector_size = self.sector_size
        result.mini_sector_size = self.mini_sector_size
        
        # Собираем все потоки
        all_streams = []
        all_storages = []
        
        def collect_nodes(node, path_prefix=""):
            current_path = f"{path_prefix}/{node.name}" if path_prefix else node.name
            if node.type == OleNodeType.STREAM:
                all_streams.append((current_path, node))
            elif node.type in (OleNodeType.STORAGE, OleNodeType.ROOT):
                if node.type != OleNodeType.ROOT:  # Не добавляем Root как отдельное хранилище
                    all_storages.append((current_path, node))
            
            for child in node.children.values():
                collect_nodes(child, current_path)
        
        collect_nodes(model.root)
        
        # Подсчитываем общее количество секторов, необходимых для данных
        total_normal_data_size = sum(node.size for _, node in all_streams if node.size >= self.mini_size_limit)
        total_mini_data_size = sum(node.size for _, node in all_streams if node.size < self.mini_size_limit)
        
        # Рассчитываем количество секторов
        normal_data_sectors = (total_normal_data_size + self.sector_size - 1) // self.sector_size
        mini_data_sectors = (total_mini_data_size + self.mini_sector_size - 1) // self.mini_sector_size
        
        # Рассчитываем сектора для различных компонентов
        # Заголовок занимает 1 сектор (сектор 0)
        header_sectors = 1
        # FAT сектора
        fat_entries_per_sector = self.sector_size // 4
        estimated_total_sectors = header_sectors + normal_data_sectors + mini_data_sectors
        fat_sectors_needed = (estimated_total_sectors + fat_entries_per_sector - 1) // fat_entries_per_sector
        
        # Уточняем расчет с учетом FAT секторов
        total_sectors = header_sectors + fat_sectors_needed + normal_data_sectors + mini_data_sectors
        fat_sectors_needed = (total_sectors + fat_entries_per_sector - 1) // fat_entries_per_sector
        
        # Если FAT секторов больше 109, потребуется DIFAT
        difat_sectors_needed = 0
        if fat_sectors_needed > 109:
            difat_refs_per_sector = (self.sector_size // 4) - 1
            additional_fat_sectors = fat_sectors_needed - 109
            difat_sectors_needed = (additional_fat_sectors + difat_refs_per_sector - 1) // difat_refs_per_sector
        
        # Сектора для директории (примерный расчет)
        dir_entries_count = len(model.all_nodes)
        dir_sectors_needed = (dir_entries_count * 128 + self.sector_size - 1) // self.sector_size  # 128 байт на запись
        
        # Сектора для MiniFAT (если есть мини-потоки)
        minifat_sectors_needed = 0
        if mini_data_sectors > 0:
            minifat_sectors_needed = (mini_data_sectors * 4 + self.sector_size - 1) // self.sector_size  # 4 байта на запись
        
        # Обновляем общее количество секторов
        total_sectors = header_sectors + fat_sectors_needed + difat_sectors_needed + \
                       dir_sectors_needed + minifat_sectors_needed + normal_data_sectors + mini_data_sectors
        
        # Назначаем физические сектора
        current_sector = 1  # Пропускаем сектор 0 (заголовок)
        
        # FAT сектора
        result.fat_sectors = list(range(current_sector, current_sector + fat_sectors_needed))
        current_sector += fat_sectors_needed
        
        # DIFAT сектора
        result.difat_sectors = list(range(current_sector, current_sector + difat_sectors_needed))
        current_sector += difat_sectors_needed
        
        # Directory сектора
        result.directory_sectors = list(range(current_sector, current_sector + dir_sectors_needed))
        current_sector += dir_sectors_needed
        
        # MiniFAT сектора
        result.minifat_sectors = list(range(current_sector, current_sector + minifat_sectors_needed))
        current_sector += minifat_sectors_needed
        
        # Назначаем сектора для мини-потоков
        result.mini_stream_sectors = list(range(current_sector, current_sector + mini_data_sectors))
        current_sector += mini_data_sectors
        
        # Назначаем сектора для обычных потоков
        for path, node in all_streams:
            if node.size >= self.mini_size_limit:
                sectors_needed = (node.size + self.sector_size - 1) // self.sector_size
                stream_sectors = list(range(current_sector, current_sector + sectors_needed))
                result.normal_stream_sectors[path] = stream_sectors
                current_sector += sectors_needed
                # Обновляем информацию в узле
                node.start_sector = stream_sectors[0] if stream_sectors else -1
                node.sector_chain = stream_sectors
            else:
                # Для мини-потоков
                sectors_needed = (node.size + self.mini_sector_size - 1) // self.mini_sector_size
                # Здесь нужно распределить мини-сектора, но для простоты просто запомним их
                node.mini_sector_chain = list(range(len(result.mini_stream_sectors) - sectors_needed, len(result.mini_stream_sectors)))
        
        result.total_sectors = current_sector
        
        # Создаем FAT массив
        result.fat_array = [0xFFFFFFFF] * result.total_sectors  # FREE_SECTOR
        
        # Помечаем FAT сектора как FATSECT
        for sector in result.fat_sectors:
            if sector < len(result.fat_array):
                result.fat_array[sector] = 0xFFFFFFFD  # FATSECT
        
        # Помечаем DIFAT сектора как DIFSECT
        for sector in result.difat_sectors:
            if sector < len(result.fat_array):
                result.fat_array[sector] = 0xFFFFFFFC  # DIFSECT
        
        # Помечаем сектора директории как цепочку
        for i, sector in enumerate(result.directory_sectors):
            if sector < len(result.fat_array):
                if i < len(result.directory_sectors) - 1:
                    result.fat_array[sector] = result.directory_sectors[i + 1]
                else:
                    result.fat_array[sector] = 0xFFFFFFFE  # END_OF_CHAIN
        
        # Помечаем сектора MiniFAT как цепочку
        for i, sector in enumerate(result.minifat_sectors):
            if sector < len(result.fat_array):
                if i < len(result.minifat_sectors) - 1:
                    result.fat_array[sector] = result.minifat_sectors[i + 1]
                else:
                    result.fat_array[sector] = 0xFFFFFFFE  # END_OF_CHAIN
        
        # Помечаем сектора нормальных потоков как цепочки
        for path, sectors in result.normal_stream_sectors.items():
            for i, sector in enumerate(sectors):
                if sector < len(result.fat_array):
                    if i < len(sectors) - 1:
                        result.fat_array[sector] = sectors[i + 1]
                    else:
                        result.fat_array[sector] = 0xFFFFFFFE  # END_OF_CHAIN
        
        return result